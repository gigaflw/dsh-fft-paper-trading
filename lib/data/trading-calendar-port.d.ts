/** Trading-day source. Dates are ISO `YYYY-MM-DD`; adapters convert at the edge. */
export interface TradingCalendarPort {
    readonly source: 'ftshare' | 'fallback';
    isTradingDay(date: string): Promise<boolean>;
    nextTradingDay(date: string): Promise<string>;
    tradingDays(from: string, to: string): Promise<string[]>;
}
/** Weekday fallback used while FTShare is absent or failing. */
export declare class WeekdayTradingCalendar implements TradingCalendarPort {
    readonly source: "fallback";
    isTradingDay(date: string): Promise<boolean>;
    tradingDays(from: string, to: string): Promise<string[]>;
    nextTradingDay(date: string): Promise<string>;
}
//# sourceMappingURL=trading-calendar-port.d.ts.map