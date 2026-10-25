import type { CalendarStatus } from '../contract.js';
/** Trading-day source. Dates are ISO `YYYY-MM-DD`; adapters convert at the edge. */
export interface TradingCalendarPort {
    /** Short form of {@link status}, kept for existing callers. */
    readonly source: 'ftshare' | 'fallback';
    /** Source plus the degradation reason, for the panel and the agent summary. */
    readonly status: CalendarStatus;
    isTradingDay(date: string): Promise<boolean>;
    nextTradingDay(date: string): Promise<string>;
    tradingDays(from: string, to: string): Promise<string[]>;
}
/** Weekday fallback used while FTShare is absent or failing. */
export declare class WeekdayTradingCalendar implements TradingCalendarPort {
    readonly source: "fallback";
    readonly status: CalendarStatus;
    /**
     * @param reason - why the weekday approximation is in use, shown in the UI.
     */
    constructor(reason?: string);
    isTradingDay(date: string): Promise<boolean>;
    tradingDays(from: string, to: string): Promise<string[]>;
    nextTradingDay(date: string): Promise<string>;
}
//# sourceMappingURL=trading-calendar-port.d.ts.map