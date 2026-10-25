/**
 * Throttle for background quote refreshes.
 *
 * The host scheduler beats every 5 seconds so a resting order fills promptly,
 * but a simulator that merely holds a position has no reason to call the data
 * gateway at that rate — on the anonymous free tier (500 requests per day) it
 * burns the whole budget in under an hour. The gate keeps the fast cadence
 * while the feed is live and backs off hard once quotes degrade to the daily
 * close or fail: those numbers do not change between two five-second beats.
 *
 * It is stateful per service instance, so the host scheduler and the visible
 * panel share one budget instead of each polling on its own.
 * @module @ft/dsh-fft-paper-trading/service/quote-gate
 */
/** Default gap between refreshes while the quote feed is live. */
export declare const LIVE_QUOTE_INTERVAL_MS = 5000;
/**
 * Default gap once quotes are the daily close (free tier) or unavailable.
 *
 * A free-tier quote is yesterday's close and does not move during the session,
 * so five minutes is plenty for marking and resting-order checks. Against the
 * anonymous 500 requests/day, one held symbol then costs ~50 refreshes a day
 * instead of thousands.
 */
export declare const DEGRADED_QUOTE_INTERVAL_MS = 300000;
export declare class QuoteRefreshGate {
    private readonly liveMs;
    private readonly degradedMs;
    private last;
    /**
     * @param liveMs - minimum gap for a live feed.
     * @param degradedMs - minimum gap once the feed is the daily close or failing.
     */
    constructor(liveMs?: number, degradedMs?: number);
    /** True when a refresh for this symbol set may run at `nowMs`. */
    allow(key: string, nowMs: number): boolean;
    /** Record one refresh and whether the quotes it returned were live. */
    record(key: string, nowMs: number, live: boolean): void;
    /** Forget the last beat, e.g. after a reset that empties the symbol set. */
    reset(): void;
}
//# sourceMappingURL=quote-gate.d.ts.map