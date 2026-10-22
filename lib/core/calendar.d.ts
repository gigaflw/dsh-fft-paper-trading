/** Trading-date helpers. MVP uses weekdays; a real calendar is P1. */
/** Trade date (Asia/Shanghai) of an ISO timestamp. */
export declare function tradeDateOf(iso: string): string;
export declare function todayTradeDate(now?: Date): string;
export declare function addDays(date: string, days: number): string;
/** Monday..Friday. Holidays come from the calendar port, not this fallback. */
export declare function isTradeDay(date: string): boolean;
export declare function daysBetween(from: string, to: string): number;
//# sourceMappingURL=calendar.d.ts.map