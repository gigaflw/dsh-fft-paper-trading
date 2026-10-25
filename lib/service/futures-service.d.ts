/**
 * Futures account service.
 *
 * Owns the clock advance (day open / settlement / trade-date roll), the data
 * port plumbing and the ledger transactions. Core stays pure; the service is
 * the only place that knows about FTShare, the trading calendar and the wall
 * clock, exactly like the stock-side `PaperService`.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/service/futures-service
 */
import type { FuturesContractQuery, FuturesContractsResult, FuturesCashFlowEntry, FuturesDraft, FuturesFillView, FuturesLedgerExport, FuturesMarketStatus, FuturesOrderView, FuturesPeriod, FuturesPositionView, FuturesPreviewView, FuturesQuotesResult, FuturesReviewView, FuturesSettings, FuturesTickView } from '../futures-contract.js';
import type { FuturesMarketDataPort } from '../data/futures-market-data-port.js';
import type { TradingCalendarPort } from '../data/trading-calendar-port.js';
import { toAccountView } from '../core/futures/views.js';
import type { DataProblem } from '../contract.js';
import type { FuturesStore } from '../store/futures-repo.js';
/** Accept any published suffix (and lower case); store the market-data form. */
export declare function normalizeFuturesSymbol(raw: string): string;
export type FuturesServiceErrorCode = 'INSUFFICIENT_MARGIN' | 'INSUFFICIENT_CASH' | 'INSUFFICIENT_POSITION' | 'CONTRACT_NOT_FOUND' | 'CONTRACT_EXPIRED' | 'NO_VOLUME' | 'LIMIT_UNAVAILABLE' | 'MARGIN_UNAVAILABLE' | 'ACCOUNT_BLOCKED' | 'INVALID_ARGUMENT' | 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'SESSION_CLOSED' | 'INTERNAL';
export declare class FuturesError extends Error {
    readonly code: FuturesServiceErrorCode;
    readonly status: number;
    constructor(code: FuturesServiceErrorCode, message: string, status?: number);
}
export interface FuturesServiceOptions {
    repo: FuturesStore;
    data: FuturesMarketDataPort;
    calendar: TradingCalendarPort;
    settings?: FuturesSettings;
    accountId?: string;
    now?: () => Date;
    logger?: {
        warn(message: string): void;
    };
}
/** Orchestrates the futures ledger, the market-data port, the calendar and the clock. */
export declare class FuturesService {
    private readonly options;
    private readonly settings;
    private readonly accountId;
    private readonly now;
    private contractsCache;
    private readonly quoteGate;
    private dataProblem;
    constructor(options: FuturesServiceOptions);
    private ts;
    private viewOf;
    private blocked;
    account(): Promise<ReturnType<typeof toAccountView>>;
    private ensureAccount;
    private sync;
    /** Trade date a fresh account starts on; after 15:30 it is already the next day. */
    private tradeDateForNow;
    /**
     * Idempotent clock advance: settle every due trade date at 15:30 and open the
     * current one at 09:00. Runs inside one store transaction so concurrent reads
     * cannot duplicate a settlement event.
     */
    private advanceTo;
    /** Symbols whose price the account cares about: open orders and held positions. */
    private symbolsInPlay;
    private callBatched;
    /** Latest observed market-data failure; drives the panel banner. */
    problem(): DataProblem | undefined;
    private noteDataProblem;
    private fetchQuoteMap;
    private fetchLimitMap;
    private fetchSettleMap;
    private fetchCloses;
    private fetchOpens;
    private ensureContracts;
    private symbolData;
    private tradeDaysToDeList;
    contracts(query?: FuturesContractQuery): Promise<FuturesContractsResult>;
    quote(symbols: readonly string[]): Promise<FuturesQuotesResult>;
    status(): Promise<FuturesMarketStatus>;
    positions(): Promise<FuturesPositionView[]>;
    orders(): Promise<FuturesOrderView[]>;
    trades(): Promise<FuturesFillView[]>;
    review(period?: FuturesPeriod): Promise<FuturesReviewView>;
    exportLedger(): Promise<FuturesLedgerExport>;
    private assertLotQty;
    preview(input: FuturesDraft): Promise<FuturesPreviewView>;
    place(input: FuturesDraft, requestId?: string): Promise<FuturesOrderView>;
    cancel(orderId: string): Promise<FuturesOrderView>;
    tick(): Promise<FuturesTickView>;
    /** Wipe the account by replacing the ledger with one genesis event. */
    reset(confirm: boolean): Promise<ReturnType<typeof toAccountView>>;
    /** Exposed for tests: current equity in cents after advancing the clock. */
    equityCents(): Promise<number>;
    /** Free cash in the ledger plus the cash effect of fills, oldest first. */
    cashFlow(): Promise<FuturesCashFlowEntry[]>;
    /** Add free cash; the amount is yuan from the UI, stored as integer cents. */
    deposit(amount: number): Promise<ReturnType<typeof toAccountView>>;
    /** Take free cash out; margin already reserved by positions cannot leave. */
    withdraw(amount: number): Promise<ReturnType<typeof toAccountView>>;
    private moveCash;
    /** `amount` is yuan from the UI; the ledger stores integer cents. */
    private cashAmountCents;
}
//# sourceMappingURL=futures-service.d.ts.map