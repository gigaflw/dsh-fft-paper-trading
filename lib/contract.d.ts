/**
 * Cross-plane contract for the paper-trading plugin.
 *
 * Browser half and host half compile against these shapes; this module must stay
 * free of runtime dependencies so both sides can import it as types.
 * @module @ft/dsh-fft-paper-trading/contract
 */
/** Exact Fetch route used by the browser half. */
export declare const PAPER_ROUTE: "/api/ft-paper-trading";
/** Request body cap; the route rejects anything larger before parsing. */
export declare const PAPER_MAX_BODY_BYTES: number;
/** Ledger schema version. v2 adds day.opened and partial fills. */
export declare const PAPER_LEDGER_VERSION = 2;
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'queued' | 'pending' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
export type DataState = 'ok' | 'stale' | 'denied' | 'failed';
export type Period = '7d' | '30d' | 'all';
/** Trading phase in Asia/Shanghai; the session table lives in core/session.ts. */
export type SessionPhase = 'pre_open' | 'continuous_am' | 'lunch' | 'continuous_pm' | 'auction_close' | 'closed';
export type FillModel = 'volume-share' | 'unlimited';
export interface PaperSettings {
    /** Starting cash in cents. */
    initialCashCents: number;
    commissionRate: number;
    minCommissionCents: number;
    stampDutyRate: number;
    transferFeeRate: number;
    slippageBps: number;
    enableT1: boolean;
    quoteTtlSec: number;
    maxOrderNotionalCents: number;
    /** Max share of a minute bar's volume one order may consume. */
    maxParticipationRate: number;
    fillModel: FillModel;
}
export declare const DEFAULT_SETTINGS: PaperSettings;
export interface Quote {
    symbol: string;
    name?: string;
    last: number;
    /** FTShare does not publish bid/ask; keep optional and never rely on it. */
    bid?: number;
    ask?: number;
    prevClose?: number;
    /** Market time of the quote/bar; null means it cannot fill. */
    marketTs?: string | null;
    /** Fetch time, for latency display only. */
    fetchedAt?: string;
    /** @deprecated v0.1 field; treated as marketTs when marketTs is absent. */
    ts?: string;
    board?: string;
    st?: boolean;
    status?: string;
    source?: string;
}
export interface Bar {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}
export interface OrderDraft {
    symbol: string;
    side: Side;
    type: OrderType;
    qty: number;
    limitPrice?: number;
    /** Manual fallback when no quote is available (market orders only). */
    price?: number;
    /** Optional journal note shown in the review view. */
    note?: string;
}
export interface OrderView {
    id: string;
    requestId: string;
    symbol: string;
    name?: string;
    side: Side;
    type: OrderType;
    qty: number;
    limitPrice?: number;
    status: OrderStatus;
    reason?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    filledAt?: string;
    fillPrice?: number;
    filledQty?: number;
    remainingQty?: number;
    avgFillPrice?: number;
    amountCents?: number;
    feesCents?: number;
}
export interface FillView {
    id: string;
    orderId: string;
    symbol: string;
    name?: string;
    side: Side;
    price: number;
    qty: number;
    amountCents: number;
    feesCents: number;
    ts: string;
    tradeDate: string;
}
export interface PositionView {
    symbol: string;
    name?: string;
    qty: number;
    available: number;
    avgCost: number;
    lastPrice?: number;
    marketValueCents?: number;
    unrealizedPnlCents?: number;
    unrealizedPnlPct?: number;
}
export interface AccountView {
    accountId: string;
    currency: 'CNY';
    initialCash: number;
    cash: number;
    marketValue: number;
    equity: number;
    pnl: number;
    pnlPct: number;
    todayPnl: number;
    tradeDate: string;
    blocked: boolean;
    positions: PositionView[];
    settings: PaperSettings;
}
export interface PreviewView {
    symbol: string;
    side: Side;
    type: OrderType;
    qty: number;
    price: number;
    amountCents: number;
    commissionCents: number;
    stampCents: number;
    transferCents: number;
    totalFeesCents: number;
    cashAfterCents: number;
    availableQty: number;
    maxBuyQty: number;
    quote?: Quote;
    priceLimit?: PriceLimit;
    session?: MarketStatus;
    warnings: string[];
}
export interface EquityPoint {
    date: string;
    equity: number;
    cash: number;
}
export interface ReviewView {
    equityCurve: EquityPoint[];
    maxDrawdownPct: number;
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    totalFees: number;
    realizedPnl: number;
    days: number;
}
export interface TickView {
    tradeDate: string;
    filled: OrderView[];
    expired: OrderView[];
    quotes: Quote[];
    notices: string[];
}
export interface MarketStatus {
    phase: SessionPhase;
    tradeDate: string;
    canSubmit: boolean;
    canMatch: boolean;
    /** ISO-8601 of the next phase boundary. */
    nextBoundary?: string;
    reason?: string;
}
export interface PriceLimit {
    upper: number;
    lower: number;
    ratio: number;
    source: 'prev-close' | 'limit-list' | 'unknown';
}
export interface SymbolHit {
    symbol: string;
    name: string;
    board?: string;
}
export interface MarketListResult {
    state: DataState;
    quotes: Quote[];
    page: number;
    total?: number;
    notice?: string;
}
export interface DayReport {
    date: string;
    equity: number;
    cash: number;
    dayPnl: number;
    fees: number;
    available: number;
    positions: PositionView[];
    gaps: Record<string, number>;
    closeSource: 'daily' | 'last' | 'missing';
}
export interface CashFlowEntry {
    ts: string;
    type: 'open' | 'reset' | 'buy' | 'sell' | 'fee';
    amount: number;
    balance: number;
    ref?: string;
}
export interface RoundTrip {
    symbol: string;
    name?: string;
    qty: number;
    cost: number;
    proceeds: number;
    pnl: number;
    holdingDays: number;
}
export interface RpcSuccess<T> {
    ok: true;
    value: T;
}
export interface RpcFailure {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}
export type RpcResult<T> = RpcSuccess<T> | RpcFailure;
export interface RpcRequest {
    endpoint: string;
    payload?: unknown;
}
export declare const DEFAULT_ACCOUNT_ID = "default";
export type ErrorCode = 'ACCOUNT_BLOCKED' | 'INVALID_ARGUMENT' | 'INVALID_SYMBOL' | 'INVALID_QTY' | 'INVALID_LOT' | 'INSUFFICIENT_CASH' | 'INSUFFICIENT_POSITION' | 'T1_LOCKED' | 'MAX_NOTIONAL' | 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'QUOTE_UNAVAILABLE' | 'QUOTE_STALE' | 'SESSION_CLOSED' | 'AUCTION_ONLY' | 'PRICE_LIMIT' | 'SUSPENDED' | 'INSUFFICIENT_LIQUIDITY';
//# sourceMappingURL=contract.d.ts.map