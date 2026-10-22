import type { AccountView, CashFlowEntry, DayReport, FillView, LedgerExport, MarketStatus, OrderDraft, OrderView, PaperSettings, PreviewView, ReviewView, RoundTrip, TickView } from '../contract.js';
import type { BarsResult, MarketDataPort, QuoteResult } from '../data/market-data-port.js';
import type { TradingCalendarPort } from '../data/trading-calendar-port.js';
import type { AccountStore } from '../store/port.js';
import type { WatchlistStore } from '../store/watchlist.js';
export interface PaperServiceOptions {
    repo: AccountStore;
    data: MarketDataPort;
    calendar: TradingCalendarPort;
    watchlist?: WatchlistStore;
    settings?: PaperSettings;
    accountId?: string;
    now?: () => Date;
    logger?: {
        warn(message: string): void;
    };
}
/** Orchestrates the ledger, the data port, the calendar and the clock. No IO of its own. */
export declare class PaperService {
    private readonly options;
    private readonly settings;
    private readonly accountId;
    private readonly now;
    constructor(options: PaperServiceOptions);
    private ts;
    account(): Promise<AccountView>;
    /** Open the account on first use, through the store transaction. */
    private ensureAccount;
    /** Open if needed, then advance the clock; every public read uses this. */
    private sync;
    private tradeDateForNow;
    /** Symbols whose price the account cares about: open orders and held positions. */
    private symbolsInPlay;
    /**
     * Fetch quotes once and normalise failures into the port's four-state result,
     * so every caller (preview, place, tick, day boundaries) reports the same shape.
     */
    private fetchQuotes;
    private fetchBars;
    private boundaryQuotes;
    private hasClosed;
    /**
     * Build the close events for one trade date. Data is fetched here; the
     * enclosing store transaction owns the append, so a concurrent read cannot
     * build the same snapshot twice.
     */
    private buildClose;
    private buildPreOpen;
    private buildOpen;
    /**
     * Idempotent clock advance: close every due trade date and open the next one.
     *
     * The whole advance runs as one store transaction. Concurrent readers queue
     * behind it, so the day-boundary events are generated exactly once and the
     * `seq` values stay contiguous. Missed sessions produce snapshots only, never
     * fills.
     */
    private advanceTo;
    /**
     * Quote for a draft, with `prevClose` recovered from the daily bars.
     *
     * FTShare's single-symbol quote has no `prevClose`, so without this the price
     * limit is unknown and an order far outside the band would pass risk.
     */
    private quoteFor;
    private withPrevClose;
    private prevCloseFor;
    private orderDateFor;
    preview(draft: OrderDraft): Promise<PreviewView>;
    place(draft: OrderDraft, requestId?: string): Promise<OrderView>;
    cancel(orderId: string): Promise<OrderView>;
    tick(): Promise<TickView>;
    orders(): Promise<OrderView[]>;
    trades(): Promise<FillView[]>;
    review(period?: '7d' | '30d' | 'all'): Promise<ReviewView>;
    quote(symbols: string[]): Promise<QuoteResult>;
    dailyBars(symbol: string, limit?: number): Promise<BarsResult>;
    minuteBars(symbol: string, date?: string): Promise<BarsResult>;
    search(query: string, limit?: number): Promise<Awaited<ReturnType<MarketDataPort['search']>>>;
    marketList(input?: {
        board?: string;
        page?: number;
        pageSize?: number;
    }): Promise<import("../contract.js").MarketListResult>;
    watchlist(): Promise<string[]>;
    setWatchlist(symbols: string[]): Promise<string[]>;
    settingsView(): Promise<PaperSettings>;
    private marketStatusAt;
    private nextBoundaryFor;
    marketStatus(): Promise<MarketStatus>;
    cashFlow(): Promise<CashFlowEntry[]>;
    dailyReport(date?: string): Promise<DayReport[]>;
    roundtrips(): Promise<RoundTrip[]>;
    /**
     * Wipe the account by replacing the ledger with one genesis event.
     *
     * The old file is copied aside first, *before* replay is trusted: a ledger
     * that currently blocks the account (duplicate seq, NaN fill) must still be
     * resettable/exportable. Settings come from the persisted account merged over
     * the current defaults, so a legacy account does not inherit its missing
     * fields. The write is an atomic temp-file rename.
     */
    reset(confirm: boolean): Promise<AccountView>;
    /** Read-only export of the raw ledger, for a locked account's banner. */
    exportLedger(): Promise<LedgerExport>;
    /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
    equityCents(): Promise<number>;
}
//# sourceMappingURL=paper-service.d.ts.map