/**
 * Futures order engine: pure functions from (state, inputs) to events + state.
 *
 * One fill takes the whole order (no partial fills), T+0, no slippage:
 * - market: fill at the quantized last price (or the manual reference price
 *   for a degraded close);
 * - limit: fill at `min(limit, last)` for a buy / `max(limit, last)` for a
 *   sell when crossed, otherwise rest until a tick or the settlement expiry.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/engine
 */
import { amountCents, quantizePrice } from './money.js';
import { computeFuturesFees, feeSnapshotFor, feesFromSnapshot } from './fees.js';
import { marginCentsFor, marginRateFor, markToMarket, realizedPnlCents, riskRatioFor, } from './margin.js';
import { applyEvent, emptyState, normalizeFuturesSettings } from './ledger.js';
import { canTrade } from './session.js';
import { positionKey, tradeSideOf, } from './types.js';
function clone(state) {
    return structuredClone(state);
}
/** Append one event with the next sequence number and fold it into `state`. */
function append(state, events, spec, ts) {
    const seq = state.lastSeq + 1;
    const event = { seq, id: `evt-${seq}`, ts, type: spec.type, payload: spec.payload };
    events.push(event);
    applyEvent(state, event);
    return event;
}
export function openAccount(state, settings, tradeDate, ts, accountId) {
    const working = clone(state);
    const events = [];
    const normalized = normalizeFuturesSettings(settings);
    append(working, events, {
        type: 'account.opened',
        payload: { accountId, settings: normalized, initialCashCents: normalized.initialCashCents, tradeDate, ledgerVersion: state.ledgerVersion },
    }, ts);
    return { events, state: working, warnings: [] };
}
export function resetAccount(state, settings, tradeDate, ts, reason) {
    const working = clone(state);
    const events = [];
    const normalized = normalizeFuturesSettings(settings);
    append(working, events, {
        type: 'account.reset',
        payload: { settings: normalized, initialCashCents: normalized.initialCashCents, tradeDate, reason },
    }, ts);
    return { events, state: working, warnings: [] };
}
/** Move free cash in (`deposit`) or out (`withdraw`); positions and margin stay put. */
export function depositCash(state, amountCents, ts) {
    assertCashAmount(amountCents);
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'cash.deposit', payload: { amountCents, tradeDate: working.tradeDate } }, ts);
    return { events, state: working, warnings: [] };
}
export function withdrawCash(state, amountCents, ts) {
    assertCashAmount(amountCents);
    // Only free cash can leave: margin already reserved by open positions is not
    // available, and a withdrawal must not push the cash balance negative.
    if (amountCents > state.cashCents)
        throw new Error(`withdraw ${amountCents} exceeds free cash ${state.cashCents}`);
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'cash.withdraw', payload: { amountCents, tradeDate: working.tradeDate } }, ts);
    return { events, state: working, warnings: [] };
}
function assertCashAmount(amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error(`cash amount must be a positive integer of cents, got ${String(amountCents)}`);
    }
}
function settlementSnapshot(input, position, settings) {
    if (input.settle !== undefined)
        return feeSnapshotFor(input.settle, settings);
    if (position !== undefined) {
        return {
            feePerLotCents: position.feePerLotCents,
            closeTodayFeePerLotCents: position.closeTodayFeePerLotCents,
            source: position.feeSource,
        };
    }
    return feeSnapshotFor(undefined, settings);
}
function limitCrossed(buy, last, limit) {
    return buy ? last <= limit : last >= limit;
}
function withinBand(price, limit, tolerance) {
    return price >= limit.lower - tolerance && price <= limit.upper + tolerance;
}
function bandText(limit) {
    return `${String(limit.lower)}–${String(limit.upper)}`;
}
/**
 * Submit one order.
 *
 * Everything is checked before any ledger event is built; a business failure
 * is written as `order.rejected` so the panel and the review keep the attempt.
 */
export function submit(state, draft, input, requestId, ts) {
    const working = clone(state);
    const events = [];
    const warnings = [];
    const side = draft.side === 'short' ? 'short' : 'long';
    const offset = draft.offset === 'close' ? 'close' : 'open';
    const symbol = typeof draft.symbol === 'string' ? draft.symbol.trim() : '';
    const position = working.positions[positionKey(symbol, side)];
    const contract = input.contract;
    const multiplier = contract?.multiplier ?? position?.multiplier ?? 0;
    const tickSize = contract?.tickSize ?? position?.tickSize ?? 0;
    const product = contract?.product ?? position?.product ?? '';
    const name = contract?.name ?? position?.name;
    // Keep the raw value: rounding here silently turned 1.5 lots into 2.
    const qty = Number.isFinite(draft.qty) ? draft.qty : 0;
    const resolvedRate = offset === 'open'
        ? marginRateFor({ limit: input.limit, settle: input.settle, contract, settings: working.settings }).rate
        : position?.marginRate;
    const snapshot = settlementSnapshot(input, position, working.settings);
    const orderId = `ord-${input.tradeDate}-${working.lastSeq + 1}`;
    const order = {
        id: orderId,
        requestId,
        symbol,
        name,
        product,
        side,
        offset,
        type: draft.type === 'limit' ? 'limit' : 'market',
        qty,
        limitPrice: typeof draft.limitPrice === 'number' ? draft.limitPrice : undefined,
        price: typeof draft.price === 'number' ? draft.price : undefined,
        status: 'pending',
        note: typeof draft.note === 'string' && draft.note.trim() !== '' ? draft.note.trim() : undefined,
        createdAt: ts,
        updatedAt: ts,
        tradeDate: input.tradeDate,
        multiplier,
        tickSize,
        marginRate: resolvedRate,
        deListDate: contract?.deListDate ?? position?.deListDate,
        feePerLotCents: snapshot.feePerLotCents,
        closeTodayFeePerLotCents: snapshot.closeTodayFeePerLotCents,
        feeSource: snapshot.source,
    };
    const reject = (code, message) => {
        const reason = `${code}: ${message}`;
        const rejected = { ...order, status: 'rejected', reason };
        append(working, events, { type: 'order.rejected', payload: { order: rejected, reason } }, ts);
        return { events, state: working, warnings, order: working.orders[rejected.id] };
    };
    const finishPending = () => {
        if (warnings.length > 0)
            order.reason = warnings.join('；');
        append(working, events, { type: 'order.submitted', payload: { order } }, ts);
        return { events, state: working, warnings, order: working.orders[order.id] };
    };
    if (working.blocked)
        return reject('ACCOUNT_BLOCKED', working.blockedReason ?? '账户已锁定，请重置后继续');
    if (symbol === '')
        return reject('INVALID_SYMBOL', '缺少合约代码');
    if (!Number.isInteger(qty) || qty <= 0)
        return reject('INVALID_QTY', '手数必须是正整数');
    if (order.type === 'limit' && !(order.limitPrice !== undefined && order.limitPrice > 0)) {
        return reject('INVALID_ARGUMENT', '限价单必须给出正的限价');
    }
    if (order.price !== undefined && order.price <= 0)
        return reject('INVALID_ARGUMENT', '参考价必须为正');
    if (order.price !== undefined && (order.type !== 'market' || offset !== 'close')) {
        return reject('INVALID_ARGUMENT', '参考价只用于市价平仓');
    }
    if (!canTrade(input.phase))
        return reject('SESSION_CLOSED', '当前非期货日盘连续交易时段，不接受委托');
    const last = input.quote !== undefined && Number.isFinite(input.quote.last) && input.quote.last > 0
        ? quantizePrice(input.quote.last, tickSize)
        : undefined;
    const manual = order.price !== undefined && order.price > 0 ? quantizePrice(order.price, tickSize) : undefined;
    const tolerance = input.limit?.source === 'minutes' ? tickSize : 0;
    const buy = tradeSideOf(offset, side) === 'buy';
    if (offset === 'open') {
        if (contract === undefined)
            return reject('CONTRACT_NOT_FOUND', '合约不存在或合约索引不可用');
        // D9: only contracts traded today. The index volume is the only source in
        // the MVP port; when it is absent a positive last price proves a trade.
        const volume = input.quote?.volume ?? contract.volume;
        if (volume !== undefined && !(volume > 0))
            return reject('NO_VOLUME', '当日无成交，暂不可开仓');
        if (last === undefined)
            return reject('QUOTE_UNAVAILABLE', '没有可用行情，暂不可开仓');
        if (resolvedRate === undefined)
            return reject('MARGIN_UNAVAILABLE', '保证金率不可用，暂不可开仓');
        if (input.limit === undefined)
            return reject('LIMIT_UNAVAILABLE', '涨跌停数据不可用，暂不可开仓');
        if (input.tradeDaysToDeList !== undefined && input.tradeDaysToDeList <= working.settings.closeBeforeDeListDays) {
            return reject('CONTRACT_EXPIRED', `距最后交易日 ${input.tradeDaysToDeList} 个交易日，禁止开仓`);
        }
        const fillPrice = order.type === 'market'
            ? last
            : quantizePrice(buy ? Math.min(order.limitPrice ?? last, last) : Math.max(order.limitPrice ?? last, last), tickSize);
        const checkedLimit = order.type === 'limit' ? (order.limitPrice ?? fillPrice) : fillPrice;
        if (!withinBand(checkedLimit, input.limit, tolerance)) {
            return reject('PRICE_LIMIT', `价格超出涨跌停区间 ${bandText(input.limit)}`);
        }
        if (order.type === 'limit' && !limitCrossed(buy, last, checkedLimit)) {
            // Not crossed: rest without reserving anything, then let a tick decide.
            if (!withinBand(last, input.limit, tolerance)) {
                return reject('PRICE_LIMIT', `现价超出涨跌停区间 ${bandText(input.limit)}`);
            }
            return finishPending();
        }
        const margin = marginCentsFor(fillPrice, multiplier, qty, resolvedRate);
        const fee = computeFuturesFees({ offset: 'open', qty, settle: input.settle, settings: working.settings });
        warnings.push(...fee.warnings);
        const required = margin + fee.feesCents;
        if (working.cashCents < required) {
            return reject('INSUFFICIENT_MARGIN', `保证金不足，还差 ${((required - working.cashCents) / 100).toFixed(2)} 元（需 ${(required / 100).toFixed(2)}，可用 ${(working.cashCents / 100).toFixed(2)}）`);
        }
        const fill = {
            id: `fill-${order.id}-1`,
            orderId: order.id,
            symbol,
            name,
            product,
            side,
            offset,
            price: fillPrice,
            qty,
            multiplier,
            tickSize,
            amountCents: amountCents(fillPrice, multiplier, qty),
            feesCents: fee.feesCents,
            marginCents: margin,
            realizedPnlCents: 0,
            closedTodayQty: 0,
            feeSource: fee.source,
            feePerLotCents: snapshot.feePerLotCents,
            closeTodayFeePerLotCents: snapshot.closeTodayFeePerLotCents,
            marginRate: resolvedRate,
            deListDate: order.deListDate,
            ts,
            tradeDate: input.tradeDate,
        };
        if (warnings.length > 0)
            order.reason = warnings.join('；');
        append(working, events, { type: 'order.submitted', payload: { order } }, ts);
        append(working, events, { type: 'order.filled', payload: { orderId: order.id, fill } }, ts);
        return { events, state: working, warnings, order: working.orders[order.id] };
    }
    // Close: the position is the contract source of truth, so a degraded data
    // port can still close with a manual reference price.
    if (position === undefined)
        return reject('INSUFFICIENT_POSITION', '没有该方向持仓');
    if (qty > position.qty)
        return reject('INSUFFICIENT_POSITION', `平仓手数超过持仓（可平 ${position.qty} 手）`);
    const reference = last ?? manual;
    if (reference === undefined)
        return reject('QUOTE_UNAVAILABLE', '没有可用行情，请填写参考价平仓');
    if (input.limit !== undefined) {
        const checked = order.type === 'limit' ? (order.limitPrice ?? reference) : reference;
        if (!withinBand(checked, input.limit, tolerance)) {
            return reject('PRICE_LIMIT', `价格超出涨跌停区间 ${bandText(input.limit)}`);
        }
    }
    if (order.type === 'limit') {
        if (last === undefined)
            return reject('QUOTE_UNAVAILABLE', '限价平仓需要可用行情');
        if (!limitCrossed(buy, last, order.limitPrice ?? last))
            return finishPending();
    }
    const fillPrice = order.type === 'market'
        ? reference
        : quantizePrice(buy ? Math.min(order.limitPrice ?? reference, reference) : Math.max(order.limitPrice ?? reference, reference), tickSize);
    const closeFeeSettle = input.settle ?? {
        feePerLotCents: position.feePerLotCents,
        closeTodayFeePerLotCents: position.closeTodayFeePerLotCents,
    };
    const fee = computeFuturesFees({
        offset: 'close',
        qty,
        todayQty: position.todayQty,
        settle: closeFeeSettle,
        settings: working.settings,
    });
    warnings.push(...fee.warnings);
    const released = Math.round((position.marginCents * qty) / position.qty);
    const realized = realizedPnlCents(position.side, position.avgPrice, fillPrice, multiplier, qty);
    const fill = {
        id: `fill-${order.id}-1`,
        orderId: order.id,
        symbol,
        name: name ?? position.name,
        product: position.product,
        side,
        offset,
        price: fillPrice,
        qty,
        multiplier,
        tickSize,
        amountCents: amountCents(fillPrice, multiplier, qty),
        feesCents: fee.feesCents,
        marginCents: released,
        realizedPnlCents: realized,
        closedTodayQty: Math.min(qty, position.todayQty),
        feeSource: fee.source,
        feePerLotCents: position.feePerLotCents,
        closeTodayFeePerLotCents: position.closeTodayFeePerLotCents,
        marginRate: position.marginRate,
        deListDate: position.deListDate,
        ts,
        tradeDate: input.tradeDate,
    };
    if (warnings.length > 0)
        order.reason = warnings.join('；');
    append(working, events, { type: 'order.submitted', payload: { order } }, ts);
    append(working, events, { type: 'order.filled', payload: { orderId: order.id, fill } }, ts);
    return { events, state: working, warnings, order: working.orders[order.id] };
}
/** Cancel a resting order. Non-resting orders are left untouched. */
export function cancelOrder(state, orderId, ts, reason = 'user') {
    const order = state.orders[orderId];
    if (order === undefined)
        return { events: [], state, warnings: [] };
    if (order.status !== 'pending')
        return { events: [], state, order, warnings: [] };
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'order.canceled', payload: { orderId, reason, at: ts } }, ts);
    return { events, state: working, order: working.orders[orderId], warnings: [] };
}
/**
 * Match resting limit orders against fresh quotes. Market orders never rest, so
 * only limit orders can fill here. Day expiry belongs to {@link closeDay}.
 */
export function tick(state, quotes, ts) {
    const working = clone(state);
    const events = [];
    const filled = [];
    const notices = [];
    const bySymbol = new Map(quotes.map(quote => [quote.symbol, quote]));
    for (const position of Object.values(working.positions)) {
        const quote = bySymbol.get(position.symbol);
        if (quote !== undefined && Number.isFinite(quote.last) && quote.last > 0) {
            position.lastPrice = quantizePrice(quote.last, position.tickSize);
        }
    }
    for (const order of Object.values(working.orders)) {
        if (order.status !== 'pending')
            continue;
        const quote = bySymbol.get(order.symbol);
        if (quote === undefined || !quote.tradable || !Number.isFinite(quote.last) || quote.last <= 0)
            continue;
        const last = quantizePrice(quote.last, order.tickSize);
        const buy = tradeSideOf(order.offset, order.side) === 'buy';
        let price;
        if (order.type === 'limit') {
            const limit = order.limitPrice;
            if (limit === undefined || !Number.isFinite(limit) || limit <= 0)
                continue;
            const crossed = buy ? last <= limit : last >= limit;
            if (!crossed)
                continue;
            price = quantizePrice(buy ? Math.min(limit, last) : Math.max(limit, last), order.tickSize);
        }
        else {
            price = last;
        }
        const position = working.positions[positionKey(order.symbol, order.side)];
        if (order.offset === 'close') {
            if (position === undefined || position.qty < order.qty) {
                append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_position', at: ts } }, ts);
                notices.push(`${order.symbol} 挂单因可平不足取消`);
                continue;
            }
            const fee = feesFromSnapshot({ feePerLotCents: order.feePerLotCents, closeTodayFeePerLotCents: order.closeTodayFeePerLotCents, source: order.feeSource }, 'close', order.qty, position.todayQty, working.settings);
            const released = Math.round((position.marginCents * order.qty) / position.qty);
            const realized = realizedPnlCents(position.side, position.avgPrice, price, order.multiplier, order.qty);
            append(working, events, {
                type: 'order.filled',
                payload: {
                    orderId: order.id,
                    fill: {
                        id: `fill-${order.id}-1`,
                        orderId: order.id,
                        symbol: order.symbol,
                        name: order.name,
                        product: position.product,
                        side: order.side,
                        offset: 'close',
                        price,
                        qty: order.qty,
                        multiplier: order.multiplier,
                        tickSize: order.tickSize,
                        amountCents: amountCents(price, order.multiplier, order.qty),
                        feesCents: fee,
                        marginCents: released,
                        realizedPnlCents: realized,
                        closedTodayQty: Math.min(order.qty, position.todayQty),
                        feeSource: order.feeSource,
                        feePerLotCents: order.feePerLotCents,
                        closeTodayFeePerLotCents: order.closeTodayFeePerLotCents,
                        marginRate: position.marginRate,
                        deListDate: position.deListDate,
                        ts,
                        tradeDate: order.tradeDate,
                    },
                },
            }, ts);
            filled.push(working.orders[order.id]);
            continue;
        }
        const rate = order.marginRate;
        if (rate === undefined) {
            append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'margin_unavailable', at: ts } }, ts);
            notices.push(`${order.symbol} 挂单因保证金率不可用取消`);
            continue;
        }
        const margin = marginCentsFor(price, order.multiplier, order.qty, rate);
        const fee = feesFromSnapshot({ feePerLotCents: order.feePerLotCents, closeTodayFeePerLotCents: order.closeTodayFeePerLotCents, source: order.feeSource }, 'open', order.qty, 0, working.settings);
        if (working.cashCents < margin + fee) {
            append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_margin', at: ts } }, ts);
            notices.push(`${order.symbol} 挂单因保证金不足取消`);
            continue;
        }
        append(working, events, {
            type: 'order.filled',
            payload: {
                orderId: order.id,
                fill: {
                    id: `fill-${order.id}-1`,
                    orderId: order.id,
                    symbol: order.symbol,
                    name: order.name,
                    product: order.product,
                    side: order.side,
                    offset: 'open',
                    price,
                    qty: order.qty,
                    multiplier: order.multiplier,
                    tickSize: order.tickSize,
                    amountCents: amountCents(price, order.multiplier, order.qty),
                    feesCents: fee,
                    marginCents: margin,
                    realizedPnlCents: 0,
                    closedTodayQty: 0,
                    feeSource: order.feeSource,
                    feePerLotCents: order.feePerLotCents,
                    closeTodayFeePerLotCents: order.closeTodayFeePerLotCents,
                    marginRate: rate,
                    deListDate: order.deListDate,
                    ts,
                    tradeDate: order.tradeDate,
                },
            },
        }, ts);
        filled.push(working.orders[order.id]);
    }
    return { events, state: working, filled, notices, warnings: [] };
}
function snapshotOf(position) {
    return {
        symbol: position.symbol,
        name: position.name,
        product: position.product,
        side: position.side,
        qty: position.qty,
        todayQty: position.todayQty,
        avgPrice: position.avgPrice,
        lastPrice: position.lastPrice,
        multiplier: position.multiplier,
        marginCents: position.marginCents,
        marginRate: position.marginRate,
        deListDate: position.deListDate,
    };
}
/**
 * Close one trade date (D15/D16):
 * 1. mark positions to the close price,
 * 2. force-close positions when risk ≥ liquidation line or the contract expired,
 * 3. expire resting orders,
 * 4. snapshot equity and advance the trade date to `nextTradeDate`.
 *
 * A missing close price leaves the position on its last mark and skips its
 * forced close instead of guessing a price.
 */
export function closeDay(state, options) {
    const working = clone(state);
    const events = [];
    const notices = [...(options.warnings ?? [])];
    const expired = [];
    const liquidated = [];
    for (const position of Object.values(working.positions)) {
        const close = options.closes[position.symbol];
        if (close !== undefined && Number.isFinite(close) && close > 0) {
            position.lastPrice = quantizePrice(close, position.tickSize);
        }
    }
    const marks = markToMarket(working);
    let riskHit = Object.keys(working.positions).length > 0
        && riskRatioFor(marks.marginCents, marks.equityCents) >= working.settings.liquidateRiskRatio;
    // Without a close price the "close" is a stale mark: fail closed and skip the
    // risk liquidation rather than guessing a price to trade at. Expiry closes
    // still run so a position cannot silently carry into delivery.
    if (riskHit && options.closeSource === 'missing') {
        riskHit = false;
        notices.push('缺少收盘价，跳过收盘强平检查');
    }
    for (const position of Object.values(working.positions)) {
        const expiry = position.deListDate !== undefined && position.deListDate !== '' && position.deListDate <= options.date;
        if (!riskHit && !expiry)
            continue;
        const price = position.lastPrice;
        if (price === undefined || !Number.isFinite(price) || price <= 0) {
            notices.push(`${position.symbol} 缺少收盘价，未执行${riskHit ? '强平' : '到期平仓'}`);
            continue;
        }
        const quantized = quantizePrice(price, position.tickSize);
        const reason = riskHit ? 'risk' : 'expiry';
        const fees = feesFromSnapshot({ feePerLotCents: position.feePerLotCents, closeTodayFeePerLotCents: position.closeTodayFeePerLotCents, source: position.feeSource }, 'close', position.qty, position.todayQty, working.settings);
        const released = position.marginCents;
        const realized = realizedPnlCents(position.side, position.avgPrice, quantized, position.multiplier, position.qty);
        const liquidatedAt = options.ts;
        const orderId = `liq-${options.date}-${position.symbol}-${position.side}`;
        const order = {
            id: orderId,
            requestId: orderId,
            symbol: position.symbol,
            name: position.name,
            product: position.product,
            side: position.side,
            offset: 'close',
            type: 'market',
            qty: position.qty,
            status: 'filled',
            reason: reason === 'risk' ? '收盘风险度超线，强制平仓' : '合约到期，强制平仓',
            createdAt: liquidatedAt,
            updatedAt: liquidatedAt,
            filledAt: liquidatedAt,
            fillPrice: quantized,
            marginCents: released,
            feesCents: fees,
            tradeDate: options.date,
            multiplier: position.multiplier,
            tickSize: position.tickSize,
            marginRate: position.marginRate,
            deListDate: position.deListDate,
            feePerLotCents: position.feePerLotCents,
            closeTodayFeePerLotCents: position.closeTodayFeePerLotCents,
            feeSource: position.feeSource,
        };
        const fill = {
            id: `liq-fill-${options.date}-${position.symbol}-${position.side}`,
            orderId,
            symbol: position.symbol,
            name: position.name,
            product: position.product,
            side: position.side,
            offset: 'close',
            price: quantized,
            qty: position.qty,
            multiplier: position.multiplier,
            tickSize: position.tickSize,
            amountCents: amountCents(quantized, position.multiplier, position.qty),
            feesCents: fees,
            marginCents: released,
            realizedPnlCents: realized,
            closedTodayQty: position.todayQty,
            feeSource: position.feeSource,
            feePerLotCents: position.feePerLotCents,
            closeTodayFeePerLotCents: position.closeTodayFeePerLotCents,
            marginRate: position.marginRate,
            deListDate: position.deListDate,
            ts: liquidatedAt,
            tradeDate: options.date,
        };
        liquidated.push(fill);
        append(working, events, { type: 'position.forced_liquidation', payload: { date: options.date, reason, fills: [fill], orders: [order] } }, options.ts);
        notices.push(`${position.symbol} ${position.side === 'long' ? '多' : '空'} ${position.qty} 手${reason === 'risk' ? '风险度超线强平' : '到期强平'} @ ${quantized}`);
    }
    for (const order of Object.values(working.orders)) {
        if (order.status !== 'pending')
            continue;
        if (order.tradeDate > options.date)
            continue;
        append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'expired', at: options.ts } }, options.ts);
        expired.push(working.orders[order.id]);
    }
    const finalMarks = markToMarket(working);
    const feesCents = working.fills
        .filter(fill => fill.tradeDate === options.date)
        .reduce((sum, fill) => sum + fill.feesCents, 0);
    const point = {
        date: options.date,
        nextDate: options.nextTradeDate,
        equityCents: finalMarks.equityCents,
        cashCents: working.cashCents,
        marginCents: finalMarks.marginCents,
        feesCents,
        closePrices: Object.fromEntries(Object.values(working.positions)
            .filter(position => position.lastPrice !== undefined)
            .map(position => [position.symbol, position.lastPrice])),
        positions: Object.values(working.positions).map(snapshotOf),
        closeSource: options.closeSource,
        liquidations: liquidated.length,
        warnings: notices,
        recordedAt: options.recordedAt,
    };
    append(working, events, { type: 'day.closed', payload: point }, options.ts);
    return { events, state: working, notices, expired, liquidated, warnings: [] };
}
/** Start a trade date: advance the date, mark the opens and clear today's bucket. */
export function openDay(state, options) {
    const working = clone(state);
    const events = [];
    const openPrices = {};
    for (const [symbol, price] of Object.entries(options.opens)) {
        const position = Object.values(working.positions).find(item => item.symbol === symbol);
        openPrices[symbol] = position === undefined ? price : quantizePrice(price, position.tickSize);
    }
    append(working, events, {
        type: 'day.opened',
        payload: { date: options.date, openPrices, recordedAt: options.recordedAt },
    }, options.ts);
    return { events, state: working, warnings: [] };
}
/** Convenience: a clean state for tests and the store's empty ledger. */
export function newState(accountId) {
    return emptyState(accountId);
}
//# sourceMappingURL=engine.js.map