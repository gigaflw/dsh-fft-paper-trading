import { addDays, isTradeDay } from '../core/calendar.js';
/** Weekday fallback used while FTShare is absent or failing. */
export class WeekdayTradingCalendar {
    source = 'fallback';
    async isTradingDay(date) {
        return isTradeDay(date);
    }
    async tradingDays(from, to) {
        const days = [];
        for (let cursor = from; cursor <= to && days.length < 400; cursor = addDays(cursor, 1)) {
            if (isTradeDay(cursor))
                days.push(cursor);
        }
        return days;
    }
    async nextTradingDay(date) {
        let cursor = addDays(date, 1);
        for (let i = 0; i < 30; i += 1) {
            if (isTradeDay(cursor))
                return cursor;
            cursor = addDays(cursor, 1);
        }
        return addDays(date, 1);
    }
}
//# sourceMappingURL=trading-calendar-port.js.map