/**
 * Futures account service.
 *
 * Owns the clock advance (day open / settlement / trade-date roll), the data
 * port plumbing and the ledger transactions. Core stays pure; the service is
 * the only place that knows about FTShare, the trading calendar and the wall
 * clock, exactly like the stock-side `PaperService`.
 *
 * @module @ft/dsh-fft-paper-trading/service/futures-service
 */
import type { FuturesContractQuery, FuturesContractsResult, FuturesDraft, FuturesFillView, FuturesLedgerExport, FuturesMarketStatus, FuturesOrderView, FuturesPeriod, FuturesPositionView, FuturesPreviewView, FuturesQuotesResult, FuturesReviewView, FuturesSettings, FuturesTickView } from '../futures-contract.js';
import type { FuturesMarketDataPort } from '../data/futures-market-data-port.js';
import type { TradingCalendarPort } from '../data/trading-calendar-port.js';
import { toAccountView } from '../core/futures/views.js';
import type { FuturesStore } from '../store/futures-repo.js';
export type FuturesServiceErrorCode = 'INSUFFICIENT_MARGIN' | 'INSUFFICIENT_POSITION' | 'CONTRACT_NOT_FOUND' | 'CONTRACT_EXPIRED' | 'NO_VOLUME' | 'LIMIT_UNAVAILABLE' | 'MARGIN_UNAVAILABLE' | 'ACCOUNT_BLOCKED' | 'INVALID_ARGUMENT' | 'ORDER_NOT_FOUND' | 'ORDER_NOT_PENDING' | 'SESSION_CLOSED' | 'INTERNAL';
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
    preview(draft: FuturesDraft): Promise<FuturesPreviewView>;
    place(draft: FuturesDraft, requestId?: string): Promise<FuturesOrderView>;
    cancel(orderId: string): Promise<FuturesOrderView>;
    tick(): Promise<FuturesTickView>;
    /** Wipe the account by replacing the ledger with one genesis event. */
    reset(confirm: boolean): Promise<ReturnType<typeof toAccountView>>;
    /** Exposed for tests: current equity in cents after advancing the clock. */
    equityCents(): Promise<number>;
}
//# sourceMappingURL=futures-service.d.ts.map