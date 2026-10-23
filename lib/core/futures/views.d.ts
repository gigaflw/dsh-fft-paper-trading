/**
 * Futures views: ledger state → the frozen cross-plane shapes.
 *
 * All money fields in the contract are cents; only `equity`, `pnl` etc. are
 * yuan, matching the stock-side convention.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/views
 */
import type { FuturesAccountView, FuturesCashFlowEntry, FuturesDraft, FuturesFillView, FuturesLimitView, FuturesMarketStatus, FuturesOrderView, FuturesPositionView, FuturesPreviewView, FuturesQuoteView, FuturesReviewView } from '../../futures-contract.js';
import { type DaySessions } from './session.js';
import { type ContractTerms, type FuturesAccountState, type FuturesFill, type FuturesOrder, type FuturesPosition, type LimitInput, type QuoteInput, type SettleInput } from './types.js';
export declare function toPositionView(position: FuturesPosition): FuturesPositionView;
export declare function positionViews(state: FuturesAccountState): FuturesPositionView[];
export declare function toOrderView(order: FuturesOrder): FuturesOrderView;
export declare function orderViews(state: FuturesAccountState): FuturesOrderView[];
export declare function toFillView(fill: FuturesFill): FuturesFillView;
export declare function fillViews(state: FuturesAccountState): FuturesFillView[];
/** Deposits minus withdrawals after the account opened, in cents. */
export declare function netCashFlowCents(state: FuturesAccountState): number;
/** Net cash moved on the current trade date, in cents. */
export declare function todayCashFlowCents(state: FuturesAccountState): number;
/** Money in/out plus the cash effect of opening and closing positions. */
export declare function cashFlowViews(state: FuturesAccountState): FuturesCashFlowEntry[];
export declare function toAccountView(state: FuturesAccountState, ledgerPath?: string): FuturesAccountView;
export declare function marketStatusAt(tradeDate: string, sessions: DaySessions, nowIso: string): FuturesMarketStatus;
export declare function quoteView(symbol: string, quote: QuoteInput, name?: string): FuturesQuoteView;
export declare function limitView(limit: LimitInput, symbol: string): FuturesLimitView;
export interface PreviewInput {
    state: FuturesAccountState;
    draft: FuturesDraft;
    contract?: ContractTerms;
    quote?: QuoteInput;
    limit?: LimitInput;
    settle?: SettleInput;
    sessions: DaySessions;
    nowIso: string;
    tradeDaysToDeList?: number;
    warnings?: string[];
}
/** Preview is never a write: it explains what would happen and what is missing. */
export declare function previewOrder(input: PreviewInput): FuturesPreviewView;
/** Review statistics: curve, drawdown, fill counts and realized PnL by product. */
export declare function toReview(state: FuturesAccountState, period: '7d' | '30d' | 'all', nowDate: string): FuturesReviewView;
//# sourceMappingURL=views.d.ts.map