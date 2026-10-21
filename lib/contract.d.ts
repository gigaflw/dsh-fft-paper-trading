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
/** Ledger schema version. */
export declare const PAPER_LEDGER_VERSION = 1;
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'canceled' | 'rejected' | 'expired';
export type DataState = 'ok' | 'stale' | 'denied' | 'failed';
export type Period = '7d' | '30d' | 'all';
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
}
export declare const DEFAULT_SETTINGS: PaperSettings;
export interface Quote {
    symbol: string;
    name?: string;
    last: number;
    bid: number;
    ask: number;
    prevClose?: number;
    /** ISO-8601 timestamp. */
    ts: string;
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
    createdAt: string;
    updatedAt: string;
    filledAt?: string;
    fillPrice?: number;
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
export type ErrorCode = 'ACCOUNT_BLOCKED' | 'INVALID_ARGUMENT' | 'INVALID_SYMBOL' | 'INVALID_QTY' | 'INVALID_LOT' | 'INSUFFICIENT_CASH' | 'INSUFFICIENT_POSITION' | 'T1_LOCKED' | 'MAX_NOTIONAL' | 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'QUOTE_UNAVAILABLE' | 'QUOTE_STALE';
//# sourceMappingURL=contract.d.ts.map