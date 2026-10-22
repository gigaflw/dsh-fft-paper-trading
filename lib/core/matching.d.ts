import type { Quote } from '../contract.js';
import type { Order } from './types.js';
export interface FillDecision {
    fill: boolean;
    price?: number;
    reason?: 'NO_QUOTE' | 'NOT_CROSSED';
}
/**
 * M2 fill rule: the whole remaining quantity trades at `quote.last` (rounded
 * to 0.01), with no slippage and no volume cap.
 *
 * The only gate is a usable last price. Market orders always fill; a buy limit
 * fills when `last <= limit`, a sell limit when `last >= limit`. Session
 * gating happens before matching, in the service.
 */
export declare function decideFill(order: Order, quote: Quote): FillDecision;
//# sourceMappingURL=matching.d.ts.map