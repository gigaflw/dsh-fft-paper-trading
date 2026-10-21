import type { PaperSettings, Quote } from '../contract.js';
export interface FeeBreakdown {
    commissionCents: number;
    stampCents: number;
    transferCents: number;
    totalCents: number;
}
export interface FillRecord {
    id: string;
    orderId: string;
    symbol: string;
    name?: string;
    side: 'buy' | 'sell';
    price: number;
    qty: number;
    amountCents: number;
    fees: FeeBreakdown;
    ts: string;
    tradeDate: string;
}
export interface Order {
    id: string;
    requestId: string;
    symbol: string;
    name?: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    qty: number;
    limitPrice?: number;
    status: 'pending' | 'filled' | 'canceled' | 'rejected' | 'expired';
    reason?: string;
    createdAt: string;
    updatedAt: string;
    filledAt?: string;
    fillPrice?: number;
    fees?: FeeBreakdown;
    tradeDate: string;
}
export interface Position {
    symbol: string;
    name?: string;
    qty: number;
    /** Shares sellable today. */
    available: number;
    /** Total cost basis in cents, fees included. */
    costCents: number;
    lastPrice?: number;
    lastTs?: string;
}
export interface DayPoint {
    date: string;
    equityCents: number;
    cashCents: number;
    /** Trade date that becomes current after this close. */
    nextDate?: string;
}
export interface AccountState {
    accountId: string;
    version: number;
    initialCashCents: number;
    cashCents: number;
    settings: PaperSettings;
    positions: Record<string, Position>;
    orders: Record<string, Order>;
    fills: FillRecord[];
    tradeDate: string;
    blocked: boolean;
    lastSeq: number;
    createdAt: string;
    dayEquity: DayPoint[];
}
export type LedgerEvent = {
    seq: number;
    id: string;
    ts: string;
    type: 'account.opened';
    payload: {
        accountId: string;
        settings: PaperSettings;
        initialCashCents: number;
        tradeDate: string;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'account.reset';
    payload: {
        settings: PaperSettings;
        initialCashCents: number;
        tradeDate: string;
        reason: string;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'order.submitted';
    payload: {
        order: Order;
        quote: Quote;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'order.filled';
    payload: {
        orderId: string;
        fill: FillRecord;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'order.rejected';
    payload: {
        order: Order;
        reason: string;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'order.canceled';
    payload: {
        orderId: string;
        reason: string;
        at: string;
    };
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'day.closed';
    payload: DayPoint;
} | {
    seq: number;
    id: string;
    ts: string;
    type: 'ledger.violation';
    payload: {
        check: string;
        expected: string;
        actual: string;
    };
};
//# sourceMappingURL=types.d.ts.map