import { amountCents, roundPrice } from './money.js';
import { computeFees } from './fees.js';
import { estimatePrice } from './risk.js';
import { equityCents } from './engine.js';
import { daysBetween } from './calendar.js';
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
        amountCents: order.fillPrice === undefined ? undefined : amountCents(order.fillPrice, order.qty),
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
        positions,
        settings: state.settings,
    };
}
export function previewOrder(state, draft, quote, settings) {
    const price = estimatePrice(draft, quote, settings) ?? 0;
    const amount = amountCents(price, draft.qty);
    const fees = computeFees(amount, draft.side, settings);
    const warnings = [];
    if (quote === null && draft.type === 'market' && draft.price === undefined) {
        warnings.push('没有可用行情，请填写参考价或改用限价单');
    }
    if (draft.side === 'sell') {
        const available = state.positions[draft.symbol]?.available ?? 0;
        if (available < draft.qty)
            warnings.push(`可卖不足：可卖 ${available} 股`);
    }
    const maxBuyQty = price > 0
        ? Math.floor(state.cashCents / (price * 100 * (1 + settings.commissionRate + settings.transferFeeRate)) / 100) * 100
        : 0;
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
        cashAfterCents: draft.side === 'buy' ? state.cashCents - amount - fees.totalCents : state.cashCents + amount - fees.totalCents,
        availableQty: state.positions[draft.symbol]?.available ?? 0,
        maxBuyQty: Math.max(0, maxBuyQty),
        quote: quote ?? undefined,
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