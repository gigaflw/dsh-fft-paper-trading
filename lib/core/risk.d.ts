import type { ErrorCode, OrderDraft, PaperSettings, Quote } from '../contract.js';
import type { AccountState } from './types.js';
export type RiskResult = {
    ok: true;
    price: number;
    amountCents: number;
} | {
    ok: false;
    code: ErrorCode;
    message: string;
};
/** Estimate the fill price used by risk, preview and the submit path. */
export declare function estimatePrice(draft: OrderDraft, quote: Quote | null, settings: PaperSettings): number | null;
/**
 * Pre-trade checks. Everything the MVP promises is checked here before an
 * order can enter the ledger; failures are returned, never thrown.
 */
export declare function checkOrder(state: AccountState, draft: OrderDraft, quote: Quote | null, settings: PaperSettings): RiskResult;
//# sourceMappingURL=risk.d.ts.map