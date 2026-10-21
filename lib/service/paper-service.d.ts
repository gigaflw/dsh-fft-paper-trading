import type { AccountView, FillView, OrderDraft, OrderView, PaperSettings, PreviewView, ReviewView, TickView } from '../contract.js';
import type { BarsResult, MarketDataPort, QuoteResult } from '../data/market-data-port.js';
import type { AccountStore } from '../store/port.js';
export interface PaperServiceOptions {
    repo: AccountStore;
    data: MarketDataPort;
    settings?: PaperSettings;
    accountId?: string;
    now?: () => Date;
    logger?: {
        warn(message: string): void;
    };
}
/** Orchestrates the ledger, the data port and the clock. No IO of its own. */
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
     * so every caller (preview, place, tick, rollover) reports the same shape.
     */
    private fetchQuotes;
    private rollover;
    private quoteFor;
    preview(draft: OrderDraft): Promise<PreviewView>;
    place(draft: OrderDraft, requestId?: string): Promise<OrderView>;
    cancel(orderId: string): Promise<OrderView>;
    tick(): Promise<TickView>;
    orders(): Promise<OrderView[]>;
    trades(): Promise<FillView[]>;
    review(period?: '7d' | '30d' | 'all'): Promise<ReviewView>;
    quote(symbols: string[]): Promise<QuoteResult>;
    bars(symbol: string, limit?: number): Promise<BarsResult>;
    settingsView(): Promise<PaperSettings>;
    /**
     * Wipe the account while keeping its current settings. The reset command goes
     * through the same append path as every other command, so the ledger still
     * verifies and the pre-reset file is copied aside first.
     */
    reset(confirm: boolean): Promise<AccountView>;
}
//# sourceMappingURL=paper-service.d.ts.map