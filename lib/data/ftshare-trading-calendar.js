import { addDays } from '../core/calendar.js';
import { WeekdayTradingCalendar } from './trading-calendar-port.js';
function apiDate(date) {
    return Number(date.replaceAll('-', ''));
}
function isoDate(value) {
    const digits = String(value ?? '').trim();
    if (!/^\d{8}$/.test(digits))
        return undefined;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
/**
 * Trading calendar over FTShare's `ft_v1_time_trading_calendar`.
 *
 * The upstream schema takes YYYYMMDD integers and returns an integer
 * `trade_dates` array; this adapter is the only place that converts them.
 * Failures fall back to weekdays and flip {@link source}, so the UI can say
 * the holiday calendar is degraded instead of silently guessing.
 */
export class FtshareTradingCalendar {
    service;
    fallback = new WeekdayTradingCalendar();
    degraded = false;
    cache = new Map();
    constructor(service) {
        this.service = service;
    }
    get source() {
        return this.degraded ? 'fallback' : 'ftshare';
    }
    async tradingDays(from, to) {
        const key = `${from}:${to}`;
        const cached = this.cache.get(key);
        if (cached !== undefined)
            return cached;
        try {
            const result = await this.service.call('ft_v1_time_trading_calendar', {
                market: 'cn',
                start_date: apiDate(from),
                end_date: apiDate(to),
            });
            if (result.state === 'denied' || result.state === 'failed')
                throw new Error(result.notice?.message ?? result.state);
            const rows = Array.isArray(result.rows) ? result.rows : [];
            const raw = rows[0]?.trade_dates;
            const days = (Array.isArray(raw) ? raw : [])
                .map(isoDate)
                .filter((value) => value !== undefined);
            this.degraded = false;
            this.cache.set(key, days);
            return days;
        }
        catch {
            this.degraded = true;
            const days = await this.fallback.tradingDays(from, to);
            this.cache.set(key, days);
            return days;
        }
    }
    async isTradingDay(date) {
        return (await this.tradingDays(date, date)).includes(date);
    }
    async nextTradingDay(date) {
        const days = await this.tradingDays(addDays(date, 1), addDays(date, 30));
        return days[0] ?? (await this.fallback.nextTradingDay(date));
    }
}
//# sourceMappingURL=ftshare-trading-calendar.js.map