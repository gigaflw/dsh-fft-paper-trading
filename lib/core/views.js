import { amountCents, roundPrice } from './money.js';
import { computeFees } from './fees.js';
import { estimatePrice } from './risk.js';
import { equityCents } from './engine.js';
import { daysBetween } from './calendar.js';
import { priceLimitFor } from './price-limit.js';
export function toPositionView(position) {
    const avgCost = position.qty > 0 ? position.costCents / position.qty / 100 : 0;
    const marketValueCents = position.lastPrice === undefined ? position.costCents : amountCents(position.lastPrice, position.qty);
    const unrealized = marketValueCents - position.costCents;
    return {
        symbol: position.symbol,
        name: position.name,
        qty: position.qty,
        available: position.available,
        avgCost: roundPrice(avgCost),
        lastPrice: position.lastPrice,
        marketValueCents,
        unrealizedPnlCents: unrealized,
        unrealizedPnlPct: position.costCents > 0 ? unrealized / position.costCents : 0,
    };
}
export function toOrderView(order) {
    const fill = order.fees === undefined ? undefined : order.fees.totalCents;
    return {
        id: order.id,
        requestId: order.requestId,
        symbol: order.symbol,
        name: order.name,
        side: order.side,
        type: order.type,
        qty: order.qty,
        limitPrice: order.limitPrice,
        status: order.status,
        reason: order.reason,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        filledAt: order.filledAt,
        fillPrice: order.fillPrice,
        filledQty: order.filledQty,
        remainingQty: order.remainingQty,
        avgFillPrice: order.avgFillPrice,
        note: order.note,
        amountCents: order.avgFillPrice === undefined ? undefined : amountCents(order.avgFillPrice, order.filledQty),
        feesCents: fill,
    };
}
export function toFillView(fill) {
    return {
        id: fill.id,
        orderId: fill.orderId,
        symbol: fill.symbol,
        name: fill.name,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        amountCents: fill.amountCents,
        feesCents: fill.fees.totalCents,
        ts: fill.ts,
        tradeDate: fill.tradeDate,
    };
}
export function toAccountView(state) {
    const positions = Object.values(state.positions)
        .map(toPositionView)
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
    const marketValueCents = positions.reduce((sum, item) => sum + (item.marketValueCents ?? 0), 0);
    const equity = state.cashCents + marketValueCents;
    const lastPoint = state.dayEquity[state.dayEquity.length - 1];
    const baseline = lastPoint !== undefined && lastPoint.date < state.tradeDate ? lastPoint.equityCents : state.initialCashCents;
    return {
        accountId: state.accountId,
        currency: 'CNY',
        initialCash: state.initialCashCents / 100,
        cash: state.cashCents / 100,
        marketValue: marketValueCents / 100,
        equity: equity / 100,
        pnl: (equity - state.initialCashCents) / 100,
        pnlPct: state.initialCashCents > 0 ? (equity - state.initialCashCents) / state.initialCashCents : 0,
        todayPnl: (equity - baseline) / 100,
        tradeDate: state.tradeDate,
        blocked: state.blocked,
        blockedReason: state.blockedReason,
        positions,
        settings: state.settings,
    };
}
/** Largest 100-share lot affordable at `price`, fees and minimum commission included. */
export function maxBuyQtyFor(cashCents, price, settings) {
    if (!Number.isFinite(cashCents) || cashCents <= 0)
        return 0;
    if (!Number.isFinite(price) || price <= 0)
        return 0;
    const perShare = price * (1 + settings.commissionRate + settings.transferFeeRate);
    if (!Number.isFinite(perShare) || perShare <= 0)
        return 0;
    let lots = Math.floor(cashCents / (perShare * 100));
    // The minimum commission can make one more lot unaffordable; walk down.
    while (lots > 0) {
        const amount = amountCents(price, lots * 100);
        if (amount + computeFees(amount, 'buy', settings).totalCents <= cashCents)
            break;
        lots -= 1;
    }
    return Math.max(0, lots * 100);
}
export function previewOrder(state, draft, quote, settings, session) {
    const price = estimatePrice(draft, quote) ?? 0;
    const amount = amountCents(price, draft.qty);
    const fees = computeFees(amount, draft.side, settings);
    const priceLimit = priceLimitFor(draft.symbol, quote?.name, quote?.prevClose);
    const warnings = [];
    if (quote === null && draft.type === 'market' && draft.price === undefined) {
        warnings.push('没有可用行情，请填写参考价或改用限价单');
    }
    // A limit order is checked at its own limit; a market order at the price it
    // would trade at (last, or the manual reference).
    const checked = draft.type === 'limit' && draft.limitPrice !== undefined && draft.limitPrice > 0 ? draft.limitPrice : price;
    if (priceLimit !== undefined && checked > 0 && (checked < priceLimit.lower || checked > priceLimit.upper)) {
        warnings.push(`价格超出涨跌停范围 ${priceLimit.lower.toFixed(2)}–${priceLimit.upper.toFixed(2)}`);
    }
    if (session !== undefined && !session.canMatch) {
        warnings.push(draft.type === 'limit'
            ? '当前时段不能连续成交，委托将排队'
            : '当前时段不能市价成交，请改用限价或等开盘');
    }
    if (quote !== null && quote.status === 'suspended')
        warnings.push('标的停牌，暂不能成交');
    // A limit that the last price has not reached cannot fill now: say so, and
    // note that the amount above is the order's worst case, not its fill.
    if (draft.type === 'limit' && quote !== null && draft.limitPrice !== undefined && draft.limitPrice > 0
        && Number.isFinite(quote.last) && quote.last > 0) {
        const crossed = draft.side === 'buy' ? quote.last <= draft.limitPrice : quote.last >= draft.limitPrice;
        if (!crossed) {
            warnings.push(`现价 ${quote.last.toFixed(2)} 未到限价 ${draft.limitPrice.toFixed(2)}，委托将挂单等待，金额按限价计`);
        }
    }
    if (draft.side === 'sell') {
        const position = state.positions[draft.symbol];
        const available = position?.available ?? 0;
        if (available < draft.qty) {
            // A holding whose shares were all bought today is not "missing": it is
            // T+1 locked. Naming the lock avoids reading "可卖 0" as a book error.
            const locked = position === undefined ? 0 : Math.max(0, position.qty - available);
            if (position !== undefined && locked > 0 && draft.qty <= position.qty) {
                warnings.push(`T+1：当日买入的 ${locked} 股下一交易日可卖（当前可卖 ${available} 股）`);
            }
            else {
                warnings.push(`可卖不足：可卖 ${available} 股`);
            }
        }
    }
    const maxBuyQty = draft.side === 'buy' ? maxBuyQtyFor(state.cashCents, price, settings) : 0;
    const cashAfterCents = draft.side === 'buy' ? state.cashCents - amount - fees.totalCents : state.cashCents + amount - fees.totalCents;
    if (draft.side === 'buy' && cashAfterCents < 0) {
        warnings.push(`可用资金不足：最多可买 ${maxBuyQty} 股`);
    }
    return {
        symbol: draft.symbol,
        side: draft.side,
        type: draft.type,
        qty: draft.qty,
        price,
        amountCents: amount,
        commissionCents: fees.commissionCents,
        stampCents: fees.stampCents,
        transferCents: fees.transferCents,
        totalFeesCents: fees.totalCents,
        cashAfterCents,
        availableQty: state.positions[draft.symbol]?.available ?? 0,
        maxBuyQty,
        // Rounding here keeps `preview.price === preview.quote.last` exact, which
        // is the same last price the fill will use.
        quote: quote === null ? undefined : { ...quote, last: roundPrice(quote.last) },
        priceLimit,
        session,
        warnings,
    };
}
function realizedPnl(state) {
    // Average-cost realized PnL for the sold quantity only.
    const lots = new Map();
    let realized = 0;
    for (const fill of state.fills) {
        const lot = lots.get(fill.symbol) ?? { qty: 0, cost: 0 };
        if (fill.side === 'buy') {
            lot.qty += fill.qty;
            lot.cost += fill.amountCents + fill.fees.totalCents;
        }
        else if (lot.qty > 0) {
            const avg = lot.cost / lot.qty;
            const costSold = Math.round(avg * fill.qty);
            realized += fill.amountCents - fill.fees.totalCents - costSold;
            lot.qty -= fill.qty;
            lot.cost -= costSold;
        }
        lots.set(fill.symbol, lot);
    }
    return realized;
}
export function toReview(state, period, nowDate) {
    const points = state.dayEquity.map(point => ({
        date: point.date,
        equity: point.equityCents / 100,
        cash: point.cashCents / 100,
    }));
    if (points.length === 0) {
        points.push({ date: state.tradeDate, equity: equityCents(state) / 100, cash: state.cashCents / 100 });
    }
    const filtered = period === 'all'
        ? points
        : points.filter(point => daysBetween(point.date, nowDate) <= (period === '7d' ? 7 : 30));
    let peak = 0;
    let maxDrawdown = 0;
    for (const point of filtered) {
        peak = Math.max(peak, point.equity);
        if (peak > 0)
            maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
    }
    const buys = state.fills.filter(fill => fill.side === 'buy').length;
    const sells = state.fills.length - buys;
    return {
        equityCurve: filtered,
        maxDrawdownPct: maxDrawdown,
        tradeCount: state.fills.length,
        buyCount: buys,
        sellCount: sells,
        totalFees: state.fills.reduce((sum, fill) => sum + fill.fees.totalCents, 0) / 100,
        realizedPnl: realizedPnl(state) / 100,
        days: filtered.length,
    };
}
//# sourceMappingURL=views.js.map