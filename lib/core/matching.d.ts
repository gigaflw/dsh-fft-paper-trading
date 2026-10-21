import type { PaperSettings, Quote } from '../contract.js';
import type { Order } from './types.js';
export interface FillDecision {
    fill: boolean;
    price?: number;
    reason?: 'QUOTE_STALE' | 'NOT_CROSSED';
}
export declare function quoteFresh(quote: Quote, settings: PaperSettings, nowMs: number): boolean;
/**
 * Fill rule for the MVP: whole-quantity fills only.
 * Market orders pay the ask / receive the bid after slippage; limit orders
 * cross only when the opposite quote reaches the limit, and are capped by it.
 */
export declare function decideFill(order: Order, quote: Quote, settings: PaperSettings, nowMs: number): FillDecision;
//# sourceMappingURL=matching.d.ts.map