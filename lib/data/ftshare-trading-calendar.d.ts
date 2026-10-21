import type { TradingCalendarPort } from './trading-calendar-port.js';
import type { FtshareDataLike } from './ftshare-market-data.js';
/**
 * Trading calendar over FTShare's `ft_v1_time_trading_calendar`.
 *
 * The upstream schema takes YYYYMMDD integers and returns an integer
 * `trade_dates` array; this adapter is the only place that converts them.
 * Failures fall back to weekdays and flip {@link source}, so the UI can say
 * the holiday calendar is degraded instead of silently guessing.
 */
export declare class FtshareTradingCalendar implements TradingCalendarPort {
    private readonly service;
    private readonly fallback;
    private degraded;
    private readonly cache;
    constructor(service: FtshareDataLike);
    get source(): 'ftshare' | 'fallback';
    tradingDays(from: string, to: string): Promise<string[]>;
    isTradingDay(date: string): Promise<boolean>;
    nextTradingDay(date: string): Promise<string>;
}
//# sourceMappingURL=ftshare-trading-calendar.d.ts.map