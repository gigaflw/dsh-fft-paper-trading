import { roundPrice, slipped } from './money.js';
export function quoteFresh(quote, settings, nowMs) {
    const ts = Date.parse(quote.ts);
    if (Number.isNaN(ts))
        return false;
    return nowMs - ts <= settings.quoteTtlSec * 1000;
}
/**
 * Fill rule for the MVP: whole-quantity fills only.
 * Market orders pay the ask / receive the bid after slippage; limit orders
 * cross only when the opposite quote reaches the limit, and are capped by it.
 */
export function decideFill(order, quote, settings, nowMs) {
    if (!quoteFresh(quote, settings, nowMs))
        return { fill: false, reason: 'QUOTE_STALE' };
    if (order.type === 'market') {
        const base = order.side === 'buy' ? quote.ask : quote.bid;
        if (!Number.isFinite(base) || base <= 0)
            return { fill: false, reason: 'QUOTE_STALE' };
        return { fill: true, price: slipped(base, order.side, settings.slippageBps) };
    }
    const limit = order.limitPrice;
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0)
        return { fill: false, reason: 'NOT_CROSSED' };
    if (order.side === 'buy') {
        if (quote.ask > limit)
            return { fill: false, reason: 'NOT_CROSSED' };
        const price = Math.min(limit, slipped(quote.ask, 'buy', settings.slippageBps));
        return { fill: true, price: roundPrice(price) };
    }
    if (quote.bid < limit)
        return { fill: false, reason: 'NOT_CROSSED' };
    const price = Math.max(limit, slipped(quote.bid, 'sell', settings.slippageBps));
    return { fill: true, price: roundPrice(price) };
}
//# sourceMappingURL=matching.js.map