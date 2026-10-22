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
/**
 * The price used by risk, preview and the submit path.
 *
 * M2 executes at the quote's last price, so a market order estimates at `last`.
 * A limit order estimates at the price it would actually trade at: `last` once
 * the limit is crossed, otherwise the limit itself — the most a buy can pay or
 * the least a sell can receive while it rests. That keeps the cash check honest
 * (a resting 10.00 bid is not charged the 11.29 last) and still makes the
 * preview agree with the fill whenever the order can fill right now. Without a
 * quote the limit, then the manual reference price, are the only sources.
 */
export declare function estimatePrice(draft: OrderDraft, quote: Quote | null): number | null;
/**
 * Pre-trade checks. Everything the MVP promises is checked here before an
 * order can enter the ledger; failures are returned, never thrown.
 */
export declare function checkOrder(state: AccountState, draft: OrderDraft, quote: Quote | null, settings: PaperSettings, tradeDate?: string): RiskResult;
//# sourceMappingURL=risk.d.ts.map