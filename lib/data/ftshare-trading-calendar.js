import { addDays } from '../core/calendar.js';
import { WeekdayTradingCalendar } from './trading-calendar-port.js';
/** How long a failed lookup is trusted before the adapter tries upstream again. */
export const CALENDAR_RETRY_MS = 60_000;
/** Longest reason kept for display; upstream errors can be paragraphs. */
const REASON_MAX_LENGTH = 120;
function apiDate(date) {
    return Number(date.replaceAll('-', ''));
}
function isoDate(value) {
    const digits = String(value ?? '').trim();
    if (!/^\d{8}$/.test(digits))
        return undefined;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
function reasonOf(error) {
    const text = error instanceof Error ? error.message : String(error);
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length <= REASON_MAX_LENGTH ? flat : `${flat.slice(0, REASON_MAX_LENGTH)}…`;
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
export class FtshareTradingCalendar {
    service;
    fallback = new WeekdayTradingCalendar();
    now;
    retryMs;
    cache = new Map();
    degraded = false;
    lastError;
    checkedAt;
    failedAt;
    constructor(service, options = {}) {
        this.service = service;
        this.now = options.now ?? (() => new Date());
        this.retryMs = options.retryMs ?? CALENDAR_RETRY_MS;
    }
    get source() {
        return this.degraded ? 'fallback' : 'ftshare';
    }
    get status() {
        return {
            source: this.source,
            ...(this.degraded && this.lastError !== undefined ? { reason: this.lastError } : {}),
            ...(this.checkedAt === undefined ? {} : { checkedAt: this.checkedAt }),
        };
    }
    async tradingDays(from, to) {
        const key = `${from}:${to}`;
        const cached = this.cache.get(key);
        if (cached !== undefined)
            return cached;
        const now = this.now();
        // Inside the retry window a failed lookup serves the weekday estimate
        // without hitting upstream again, but the result is intentionally not
        // cached: the next window gets a real answer.
        if (this.degraded && this.failedAt !== undefined && now.getTime() - this.failedAt < this.retryMs) {
            return this.fallback.tradingDays(from, to);
        }
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
            this.lastError = undefined;
            this.failedAt = undefined;
            this.checkedAt = now.toISOString();
            this.cache.set(key, days);
            return days;
        }
        catch (error) {
            this.degraded = true;
            this.lastError = reasonOf(error);
            this.failedAt = now.getTime();
            this.checkedAt = now.toISOString();
            return this.fallback.tradingDays(from, to);
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