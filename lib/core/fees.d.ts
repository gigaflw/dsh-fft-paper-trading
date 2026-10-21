import type { PaperSettings } from '../contract.js';
import type { FeeBreakdown } from './types.js';
/**
 * A-share fee model used by both preview and fill.
 *
 * Commission has a minimum; stamp duty is sell-only; transfer fee is charged
 * on both sides. Every amount is rounded to one cent independently.
 */
export declare function computeFees(amountCents: number, side: 'buy' | 'sell', settings: PaperSettings): FeeBreakdown;
//# sourceMappingURL=fees.d.ts.map