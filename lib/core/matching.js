import { roundPrice } from './money.js';
/**
 * M2 fill rule: the whole remaining quantity trades at `quote.last` (rounded
 * to 0.01), with no slippage and no volume cap.
 *
 * The only gate is a usable last price. Market orders always fill; a buy limit
 * fills when `last <= limit`, a sell limit when `last >= limit`. Session
 * gating happens before matching, in the service.
 */
export function decideFill(order, quote) {
    const last = quote.last;
    if (!Number.isFinite(last) || last <= 0)
        return { fill: false, reason: 'NO_QUOTE' };
    if (order.type === 'market')
        return { fill: true, price: roundPrice(last) };
    const limit = order.limitPrice;
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0)
        return { fill: false, reason: 'NOT_CROSSED' };
    const crossed = order.side === 'buy' ? last <= limit : last >= limit;
    return crossed ? { fill: true, price: roundPrice(last) } : { fill: false, reason: 'NOT_CROSSED' };
}
//# sourceMappingURL=matching.js.map