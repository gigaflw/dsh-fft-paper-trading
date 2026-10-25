import type { CalendarStatus } from '../contract.js';
import type { TradingCalendarPort } from './trading-calendar-port.js';
import type { FtshareDataLike } from './ftshare-market-data.js';
/** How long a failed lookup is trusted before the adapter tries upstream again. */
export declare const CALENDAR_RETRY_MS = 60000;
export interface FtshareTradingCalendarOptions {
    /** Clock for the retry window; injectable so tests do not wait a minute. */
    now?: () => Date;
    /** Retry gap after a failure; defaults to {@link CALENDAR_RETRY_MS}. */
    retryMs?: number;
}
/**
 * Trading calendar over FTShare's `ft_v1_time_trading_calendar`.
 *
 * The upstream schema takes YYYYMMDD integers and returns an integer
 * `trade_dates` array; this adapter is the only place that converts them.
 *
 * A failure falls back to weekdays and **is not cached**: the adapter retries
 * the upstream after {@link retryMs} so a recovered network or a new quota
 * window flips {@link status} back instead of keeping the holiday calendar
 * degraded for the rest of the day. Only successful answers are cached.
 */
export declare class FtshareTradingCalendar implements TradingCalendarPort {
    private readonly service;
    private readonly fallback;
    private readonly now;
    private readonly retryMs;
    private readonly cache;
    private degraded;
    private lastError;
    private checkedAt;
    private failedAt;
    constructor(service: FtshareDataLike, options?: FtshareTradingCalendarOptions);
    get source(): 'ftshare' | 'fallback';
    get status(): CalendarStatus;
    tradingDays(from: string, to: string): Promise<string[]>;
    isTradingDay(date: string): Promise<boolean>;
    nextTradingDay(date: string): Promise<string>;
}
//# sourceMappingURL=ftshare-trading-calendar.d.ts.map