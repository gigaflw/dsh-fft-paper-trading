import type { AccountView, CashFlowEntry, DayReport, FillView, MarketStatus, OrderDraft, OrderView, PaperSettings, PreviewView, ReviewView, RoundTrip, TickView } from '../contract.js';
import type { BarsResult, MarketDataPort, QuoteResult } from '../data/market-data-port.js';
import type { TradingCalendarPort } from '../data/trading-calendar-port.js';
import type { AccountStore } from '../store/port.js';
export interface PaperServiceOptions {
    repo: AccountStore;
    data: MarketDataPort;
    calendar: TradingCalendarPort;
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
    private ensureAccount;
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
    private runClose;
    private runOpen;
    /**
     * Idempotent clock advance: close every due trade date and open the next one.
     * Missed sessions produce snapshots only, never fills.
     */
    private advanceTo;
    private quoteFor;
    private volumeFor;
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
    settingsView(): Promise<PaperSettings>;
    private marketStatusAt;
    private nextBoundaryFor;
    marketStatus(): Promise<MarketStatus>;
    cashFlow(): Promise<CashFlowEntry[]>;
    dailyReport(date?: string): Promise<DayReport[]>;
    roundtrips(): Promise<RoundTrip[]>;
    /**
     * Wipe the account while keeping its current settings. The reset command goes
     * through the same append path as every other command, so the ledger still
     * verifies and the pre-reset file is copied aside first.
     */
    reset(confirm: boolean): Promise<AccountView>;
    /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
    equityCents(): Promise<number>;
}
//# sourceMappingURL=paper-service.d.ts.map