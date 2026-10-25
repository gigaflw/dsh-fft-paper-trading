import type { AccountView, BasketOrderInput, BasketOrderResult, BasketPreview, CashFlowEntry, DayReport, FillView, LedgerExport, MarketStatus, OrderDraft, OrderView, PaperSettings, PreviewView, ReviewView, RoundTrip, TickView, DataProblem } from '../contract.js';
import type { BarsResult, MarketDataPort, QuoteResult } from '../data/market-data-port.js';
import type { TradingCalendarPort } from '../data/trading-calendar-port.js';
import type { AccountStore } from '../store/port.js';
import type { ShortlistStore } from '../store/shortlist.js';
export interface PaperServiceOptions {
    repo: AccountStore;
    data: MarketDataPort;
    calendar: TradingCalendarPort;
    shortlist?: ShortlistStore;
    settings?: PaperSettings;
    accountId?: string;
    now?: () => Date;
    logger?: {
        warn(message: string): void;
    };
}
export interface LedgerStatus {
    path: string;
    exists: boolean;
    blocked: boolean;
    blockedReason?: string;
}
/** Orchestrates the ledger, the data port, the calendar and the clock. No IO of its own. */
export declare class PaperService {
    private readonly options;
    private readonly settings;
    private readonly accountId;
    private readonly now;
    private readonly quoteGate;
    private tickQuotes;
    private dataProblem;
    constructor(options: PaperServiceOptions);
    private ts;
    /** Attach the on-disk location so a locked account is repairable from a reply. */
    private viewOf;
    /** The single place that turns a blocked state into an error carrying its reason. */
    private blocked;
    account(): Promise<AccountView>;
    /** Open the account on first use, through the store transaction. */
    private ensureAccount;
    /** Open if needed, then advance the clock; every public read uses this. */
    private sync;
    private tradeDateForNow;
    /** Parse a symbol that may be any instrument (quote, chart, search result). */
    private identify;
    /** Parse a symbol that must be an A-share stock; indices and funds cannot trade. */
    private identifyStock;
    /** Symbols whose price the account cares about: open orders and held positions. */
    private symbolsInPlay;
    /**
     * Fetch quotes once and normalise failures into the port's four-state result,
     * so every caller (preview, place, tick, day boundaries) reports the same shape.
     */
    /** Latest observed market-data failure; drives the panel banner. */
    problem(): DataProblem | undefined;
    private noteDataProblem;
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
    /**
     * Session clock that also respects the calendar. `sessionPhaseAt` only knows
     * wall time, so a weekend/holiday would otherwise look like continuous
     * trading and match orders against Friday's prices.
     */
    private phaseFor;
    private orderDateFor;
    preview(input: OrderDraft): Promise<PreviewView>;
    place(input: OrderDraft, requestId?: string): Promise<OrderView>;
    /**
     * Read-only basket preview: parse the CSV, fetch every quote in one call and
     * split the budget into lots. Parse problems ride back in `issues`; only a
     * structurally invalid explicit budget throws.
     */
    basketPreview(csv: string, budgetCents?: number): Promise<BasketPreview>;
    /**
     * Place a confirmed basket.
     *
     * Everything that can reject the whole batch is checked before the store
     * transaction, so a failed pre-check writes nothing. Inside the transaction
     * rows are submitted in input order with `${batchId}:${symbol}` as the
     * request id: a retried batch reuses its orders, and a row that still fails
     * (e.g. a concurrent change) is written as `order.rejected` while the rest of
     * the batch continues.
     */
    basketPlace(rows: readonly BasketOrderInput[], batchId?: string): Promise<BasketOrderResult>;
    /** Shape-level basket checks that must run before any pre-check touches IO. */
    private basketRows;
    private basketResultRow;
    /** A row failed pre-check: the batch is refused with that row's code. */
    private basketRejection;
    cancel(orderId: string): Promise<OrderView>;
    tick(): Promise<TickView>;
    orders(): Promise<OrderView[]>;
    trades(): Promise<FillView[]>;
    review(period?: '7d' | '30d' | 'all'): Promise<ReviewView>;
    quote(symbols: string[]): Promise<QuoteResult>;
    dailyBars(symbol: string, limit?: number): Promise<BarsResult>;
    minuteBars(symbol: string, date?: string): Promise<BarsResult>;
    /**
     * Upstream adapters include FTShare function names and parameter errors in
     * their notices. Those are useful in logs, not in the panel (or to the model
     * reading a tool result), so the user-facing notice stays short.
     */
    private sanitiseDataNotice;
    /**
     * Turn an upstream failure into one actionable sentence.
     *
     * The wording lives in `friendlyDataNotice`, shared with the futures service
     * so both accounts explain the same failure the same way.
     */
    private friendlyNotice;
    search(query: string, limit?: number): Promise<Awaited<ReturnType<MarketDataPort['search']>>>;
    marketList(input?: {
        board?: string;
        page?: number;
        pageSize?: number;
    }): Promise<import("../contract.js").MarketListResult>;
    shortlist(): Promise<string[]>;
    setShortlist(symbols: string[]): Promise<string[]>;
    settingsView(): Promise<PaperSettings>;
    private marketStatusAt;
    /**
     * The next wall-clock session start. Closed covers both "before the open"
     * (today 09:15 is still ahead) and "after the close" (next trading day);
     * weekends and holidays are skipped through the calendar port.
     */
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
    /** Add cash to the account; the amount is yuan from the UI, stored as cents. */
    deposit(amount: number): Promise<AccountView>;
    /** Take cash out, never more than the free cash at the moment of the write. */
    withdraw(amount: number): Promise<AccountView>;
    private moveCash;
    /** `amount` is yuan from the UI; the ledger stores integer cents. */
    private cashAmountCents;
    /** Read-only export of the raw ledger, for a locked account's banner. */
    exportLedger(): Promise<LedgerExport>;
    /**
     * Where the ledger is and why it is locked — without the raw text.
     *
     * `exportLedger` exists for downloading; this is the answer a human or an
     * agent needs to locate the file and name the failing invariant.
     */
    ledgerStatus(): Promise<LedgerStatus>;
    /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
    equityCents(): Promise<number>;
}
//# sourceMappingURL=paper-service.d.ts.map