import type { AccountView, FillView, OrderDraft, OrderView, MarketStatus, PaperSettings, PreviewView, Quote, ReviewView } from '../contract.js';
import type { AccountState, FillRecord, Order, Position } from './types.js';
export declare function toPositionView(position: Position): AccountView['positions'][number];
export declare function toOrderView(order: Order): OrderView;
export declare function toFillView(fill: FillRecord): FillView;
/** Deposits minus withdrawals after the account opened, in cents. */
export declare function netCashFlowCents(state: AccountState): number;
/** Net cash moved on the current trade date, in cents. */
export declare function todayCashFlowCents(state: AccountState): number;
export declare function toAccountView(state: AccountState): AccountView;
/** Largest 100-share lot affordable at `price`, fees and minimum commission included. */
export declare function maxBuyQtyFor(cashCents: number, price: number, settings: PaperSettings): number;
export declare function previewOrder(state: AccountState, draft: OrderDraft, quote: Quote | null, settings: PaperSettings, session?: MarketStatus): PreviewView;
export declare function toReview(state: AccountState, period: '7d' | '30d' | 'all', nowDate: string): ReviewView;
//# sourceMappingURL=views.d.ts.map