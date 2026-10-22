/**
 * Futures ledger fold and invariants.
 *
 * Cash is free cash: opening a position reserves margin out of it, closing
 * releases margin back plus the realized PnL. Therefore
 *
 *   equity = cash + margin + unrealized(float)
 *
 * is an identity, while cash itself is only ever moved by fills and fees —
 * which is what makes replay exact without storing quote marks.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/ledger
 */
import { DEFAULT_FUTURES_SETTINGS, FUTURES_LEDGER_VERSION, } from '../../futures-contract.js';
import { positionKey } from './types.js';
function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function nonNegative(value, fallback) {
    const parsed = finite(value, Number.NaN);
    return parsed >= 0 ? parsed : fallback;
}
function positive(value, fallback) {
    const parsed = finite(value, Number.NaN);
    return parsed > 0 ? parsed : fallback;
}
/**
 * Merge persisted settings over the defaults. A hand-edited or legacy ledger
 * must never install a partial settings object: `undefined × price` would make
 * every later margin calculation NaN and block the account on the next load.
 */
export function normalizeFuturesSettings(persisted) {
    const input = (typeof persisted === 'object' && persisted !== null ? persisted : {});
    return {
        initialCashCents: Math.round(nonNegative(input.initialCashCents, DEFAULT_FUTURES_SETTINGS.initialCashCents)),
        marginUplift: nonNegative(input.marginUplift, DEFAULT_FUTURES_SETTINGS.marginUplift),
        feeMultiplier: nonNegative(input.feeMultiplier, DEFAULT_FUTURES_SETTINGS.feeMultiplier),
        warnRiskRatio: positive(input.warnRiskRatio, DEFAULT_FUTURES_SETTINGS.warnRiskRatio),
        liquidateRiskRatio: positive(input.liquidateRiskRatio, DEFAULT_FUTURES_SETTINGS.liquidateRiskRatio),
        closeBeforeDeListDays: Math.round(nonNegative(input.closeBeforeDeListDays, DEFAULT_FUTURES_SETTINGS.closeBeforeDeListDays)),
        defaultFeePerLotCents: Math.round(nonNegative(input.defaultFeePerLotCents, DEFAULT_FUTURES_SETTINGS.defaultFeePerLotCents)),
    };
}
export function emptyState(accountId) {
    return {
        accountId,
        version: 1,
        ledgerVersion: FUTURES_LEDGER_VERSION,
        initialCashCents: 0,
        cashCents: 0,
        settings: { ...DEFAULT_FUTURES_SETTINGS },
        positions: {},
        orders: {},
        fills: [],
        tradeDate: '',
        lastOpenedDate: '',
        blocked: false,
        lastSeq: 0,
        createdAt: '',
        dayEquity: [],
    };
}
function openState(state, settings, initialCashCents, tradeDate) {
    const normalized = normalizeFuturesSettings(settings);
    state.initialCashCents = Math.round(Number.isFinite(initialCashCents) && initialCashCents >= 0 ? initialCashCents : normalized.initialCashCents);
    state.cashCents = state.initialCashCents;
    state.settings = normalized;
    state.positions = {};
    state.orders = {};
    state.fills = [];
    state.dayEquity = [];
    state.tradeDate = tradeDate;
    state.lastOpenedDate = '';
    state.blocked = false;
    state.blockedReason = undefined;
}
function applyFill(state, fill) {
    const key = positionKey(fill.symbol, fill.side);
    if (fill.offset === 'open') {
        const existing = state.positions[key];
        const oldQty = existing?.qty ?? 0;
        const qty = oldQty + fill.qty;
        const avgPrice = qty > 0
            ? Number((((oldQty * (existing?.avgPrice ?? 0)) + (fill.qty * fill.price)) / qty).toFixed(6))
            : fill.price;
        const position = {
            symbol: fill.symbol,
            name: fill.name ?? existing?.name,
            product: fill.product,
            side: fill.side,
            qty,
            todayQty: (existing?.todayQty ?? 0) + fill.qty,
            avgPrice,
            lastPrice: fill.price,
            multiplier: fill.multiplier,
            tickSize: fill.tickSize,
            marginCents: (existing?.marginCents ?? 0) + fill.marginCents,
            marginRate: fill.marginRate,
            deListDate: fill.deListDate,
            openedAt: existing?.openedAt ?? fill.ts,
            feePerLotCents: fill.feePerLotCents,
            closeTodayFeePerLotCents: fill.closeTodayFeePerLotCents,
            feeSource: fill.feeSource,
        };
        state.positions[key] = position;
        state.cashCents -= fill.marginCents + fill.feesCents;
    }
    else {
        const existing = state.positions[key];
        state.cashCents += fill.marginCents + fill.realizedPnlCents - fill.feesCents;
        if (existing !== undefined) {
            const qty = existing.qty - fill.qty;
            if (qty <= 0) {
                delete state.positions[key];
            }
            else {
                state.positions[key] = {
                    ...existing,
                    qty,
                    todayQty: Math.max(0, existing.todayQty - fill.closedTodayQty),
                    marginCents: Math.max(0, existing.marginCents - fill.marginCents),
                    lastPrice: fill.price,
                };
            }
        }
    }
    state.fills.push(fill);
}
function applyOrderFill(order, fill) {
    order.status = 'filled';
    order.fillPrice = fill.price;
    order.filledAt = fill.ts;
    order.updatedAt = fill.ts;
    order.feesCents = (order.feesCents ?? 0) + fill.feesCents;
    if (fill.offset === 'open')
        order.marginCents = (order.marginCents ?? 0) + fill.marginCents;
}
/** Apply one ledger event in place. Callers own cloning. */
export function applyEvent(state, event) {
    switch (event.type) {
        case 'account.opened': {
            const { settings, initialCashCents, tradeDate, accountId, ledgerVersion } = event.payload;
            openState(state, settings, initialCashCents, tradeDate);
            state.accountId = accountId;
            state.ledgerVersion = ledgerVersion ?? FUTURES_LEDGER_VERSION;
            state.createdAt = event.ts;
            break;
        }
        case 'account.reset': {
            const { settings, initialCashCents, tradeDate } = event.payload;
            openState(state, settings, initialCashCents, tradeDate);
            state.ledgerVersion = FUTURES_LEDGER_VERSION;
            if (state.createdAt === '')
                state.createdAt = event.ts;
            break;
        }
        case 'order.submitted': {
            state.orders[event.payload.order.id] = { ...event.payload.order };
            break;
        }
        case 'order.rejected': {
            const order = { ...event.payload.order, status: 'rejected', reason: event.payload.reason };
            state.orders[order.id] = order;
            break;
        }
        case 'order.filled': {
            const order = state.orders[event.payload.orderId];
            if (order !== undefined)
                applyOrderFill(order, event.payload.fill);
            applyFill(state, event.payload.fill);
            break;
        }
        case 'order.canceled': {
            const order = state.orders[event.payload.orderId];
            if (order !== undefined) {
                order.status = event.payload.reason === 'expired' ? 'expired' : 'canceled';
                order.reason = event.payload.reason;
                order.updatedAt = event.payload.at;
            }
            break;
        }
        case 'position.forced_liquidation': {
            for (const order of event.payload.orders)
                state.orders[order.id] = { ...order };
            for (const fill of event.payload.fills)
                applyFill(state, fill);
            break;
        }
        case 'day.opened': {
            state.tradeDate = event.payload.date;
            state.lastOpenedDate = event.payload.date;
            for (const position of Object.values(state.positions)) {
                position.todayQty = 0;
                const open = event.payload.openPrices[position.symbol];
                if (open !== undefined)
                    position.lastPrice = open;
            }
            break;
        }
        case 'day.closed': {
            const point = event.payload;
            const index = state.dayEquity.findIndex(item => item.date === point.date);
            if (index >= 0)
                state.dayEquity[index] = point;
            else
                state.dayEquity.push(point);
            state.dayEquity.sort((a, b) => a.date.localeCompare(b.date));
            state.tradeDate = point.nextDate;
            for (const position of Object.values(state.positions)) {
                position.todayQty = 0;
                const close = point.closePrices[position.symbol];
                if (close !== undefined)
                    position.lastPrice = close;
            }
            break;
        }
        case 'ledger.violation': {
            state.blocked = true;
            state.blockedReason = event.payload.actual === '' ? undefined : event.payload.actual;
            break;
        }
        case 'ledger.repaired':
            break;
    }
    state.lastSeq = Math.max(state.lastSeq, event.seq);
    return state;
}
/**
 * Structural invariants checked after replay and after every write.
 *
 * Cash and margin are recomputed from the fill log: a duplicated fill, a
 * missing release or a drifted position is caught here and blocks the account
 * instead of silently producing a wrong equity.
 */
export function verify(state) {
    const issues = [];
    if (!Number.isFinite(state.cashCents) || !Number.isInteger(state.cashCents)) {
        issues.push(`现金为非法值: ${state.cashCents}`);
    }
    if (!Number.isFinite(state.initialCashCents) || state.initialCashCents < 0) {
        issues.push(`初始资金非法: ${state.initialCashCents}`);
    }
    for (const position of Object.values(state.positions)) {
        if (!Number.isInteger(position.qty) || position.qty <= 0)
            issues.push(`${position.symbol}/${position.side} 手数非法: ${position.qty}`);
        if (!Number.isInteger(position.todayQty) || position.todayQty < 0 || position.todayQty > position.qty) {
            issues.push(`${position.symbol}/${position.side} 今仓越界: ${position.todayQty}/${position.qty}`);
        }
        if (!Number.isFinite(position.avgPrice) || position.avgPrice <= 0)
            issues.push(`${position.symbol}/${position.side} 均价非法: ${position.avgPrice}`);
        if (!Number.isFinite(position.multiplier) || position.multiplier <= 0)
            issues.push(`${position.symbol}/${position.side} 乘数非法`);
        if (!Number.isFinite(position.marginCents) || position.marginCents < 0)
            issues.push(`${position.symbol}/${position.side} 保证金非法: ${position.marginCents}`);
    }
    const fillIds = new Set();
    const orderIds = new Set();
    let expectedCash = state.initialCashCents;
    let expectedMargin = 0;
    const netQty = new Map();
    for (const fill of state.fills) {
        if (!Number.isInteger(fill.qty) || fill.qty <= 0)
            issues.push(`成交数量非法: ${String(fill.qty)}`);
        if (!Number.isFinite(fill.price) || fill.price <= 0)
            issues.push(`成交价格非法: ${String(fill.price)}`);
        if (!Number.isFinite(fill.feesCents) || fill.feesCents < 0)
            issues.push(`成交费用非法: ${String(fill.feesCents)}`);
        if (!Number.isFinite(fill.marginCents) || fill.marginCents < 0)
            issues.push(`成交保证金非法: ${String(fill.marginCents)}`);
        if (!Number.isFinite(fill.realizedPnlCents))
            issues.push(`成交盈亏非法: ${String(fill.realizedPnlCents)}`);
        if (fillIds.has(fill.id))
            issues.push(`成交重复: ${fill.id}`);
        fillIds.add(fill.id);
        if (orderIds.has(fill.orderId))
            issues.push(`同一订单多笔成交（MVP 不做部分成交）: ${fill.orderId}`);
        orderIds.add(fill.orderId);
        const key = positionKey(fill.symbol, fill.side);
        if (fill.offset === 'open') {
            expectedCash -= fill.marginCents + fill.feesCents;
            expectedMargin += fill.marginCents;
            netQty.set(key, (netQty.get(key) ?? 0) + fill.qty);
        }
        else {
            expectedCash += fill.marginCents + fill.realizedPnlCents - fill.feesCents;
            expectedMargin -= fill.marginCents;
            netQty.set(key, (netQty.get(key) ?? 0) - fill.qty);
        }
    }
    if (expectedCash !== state.cashCents) {
        issues.push(`现金与成交不一致: 期望 ${expectedCash}，实际 ${state.cashCents}`);
    }
    const positionMargin = Object.values(state.positions).reduce((sum, position) => sum + position.marginCents, 0);
    if (expectedMargin !== positionMargin) {
        issues.push(`保证金与成交不一致: 期望 ${expectedMargin}，实际 ${positionMargin}`);
    }
    for (const [key, qty] of netQty) {
        const position = state.positions[key];
        const actual = position?.qty ?? 0;
        if (qty !== actual)
            issues.push(`持仓数量与成交不一致: ${key} 期望 ${qty}，实际 ${actual}`);
    }
    for (const key of Object.keys(state.positions)) {
        if (!netQty.has(key))
            issues.push(`持仓没有对应成交: ${key}`);
    }
    for (const order of Object.values(state.orders)) {
        if (!Number.isInteger(order.qty) || order.qty <= 0)
            issues.push(`订单 ${order.id} 委托数量非法`);
        if (order.status === 'filled') {
            if (order.fillPrice === undefined)
                issues.push(`订单 ${order.id} 已成交但无成交价`);
            if (!state.fills.some(fill => fill.orderId === order.id))
                issues.push(`订单 ${order.id} 已成交但无成交记录`);
        }
        if ((order.status === 'rejected' || order.status === 'canceled' || order.status === 'expired') && order.reason === undefined) {
            issues.push(`订单 ${order.id} 状态 ${order.status} 缺少原因`);
        }
    }
    return issues;
}
//# sourceMappingURL=ledger.js.map