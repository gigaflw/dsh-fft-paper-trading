/**
 * Commodity futures day session.
 *
 * MVP scope (D1): day session only — 09:00–11:30 with the 10:15–10:30 break and
 * 13:30–15:00. No night session, no CFFEX/国债 special hours. Ranges come from
 * the contract's `trade_hours_info` when it parses, with a uniform commodity
 * fallback when it does not.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/futures/session
 */
import { isoAtShanghai, shanghaiClock } from '../session.js';
const MINUTE = 1;
const HOUR = 60;
const DAY_START = 8 * HOUR;
const DAY_END = 16 * HOUR;
/** 15:30 close + settlement, when the trade date advances (D1). */
export const SETTLEMENT_MINUTES = 15 * HOUR + 30 * MINUTE;
export const OPEN_MINUTES = 9 * HOUR;
/** Uniform session of the five commodity exchanges when the text is unusable. */
export const DEFAULT_DAY_WINDOWS = [
    { start: 9 * HOUR, end: 10 * HOUR + 15 * MINUTE },
    { start: 10 * HOUR + 30 * MINUTE, end: 11 * HOUR + 30 * MINUTE },
    { start: 13 * HOUR + 30 * MINUTE, end: 15 * HOUR },
];
/**
 * Per-product override point. All SHFE/INE/DCE/CZCE/GFEX products share the
 * same day session today; a product with different hours is added here and in
 * {@link fallbackDaySessions} only after it is proven by the exchange feed.
 */
const PRODUCT_DAY_WINDOWS = {};
const RANGE = /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;
const MORNING_BREAK_START = 10 * HOUR + 15 * MINUTE;
const MORNING_BREAK_END = 10 * HOUR + 30 * MINUTE;
/** Uniform commodity fallback, with a product override hook. */
export function fallbackDaySessions(product) {
    const key = (product ?? '').toLowerCase();
    const override = PRODUCT_DAY_WINDOWS[key];
    if (override !== undefined)
        return { windows: override, source: 'fallback' };
    return { windows: DEFAULT_DAY_WINDOWS, source: 'fallback' };
}
function expandMorningBreak(ranges) {
    const out = [];
    for (const range of ranges) {
        // `9:00-11:30` covers the universal 10:15–10:30 break; split it so the
        // phase machine can report `lunch` inside the morning.
        if (range.start <= MORNING_BREAK_START && range.end >= MORNING_BREAK_END) {
            out.push({ start: range.start, end: MORNING_BREAK_START });
            out.push({ start: MORNING_BREAK_END, end: range.end });
        }
        else {
            out.push(range);
        }
    }
    return out;
}
function usableWindows(windows) {
    if (windows.length < 2 || windows.length > 4)
        return false;
    let previousEnd = -1;
    for (const window of windows) {
        if (!Number.isInteger(window.start) || !Number.isInteger(window.end))
            return false;
        if (window.start < DAY_START || window.end > DAY_END)
            return false;
        if (window.start >= window.end)
            return false;
        if (window.start < previousEnd)
            return false;
        previousEnd = window.end;
    }
    const first = windows[0];
    const last = windows[windows.length - 1];
    // Guard against a half-parsed morning-only or night-shifted text.
    if (first === undefined || last === undefined)
        return false;
    if (first.start > 10 * HOUR || last.end < 14 * HOUR)
        return false;
    return true;
}
/**
 * Parse the day ranges out of `trade_hours_info`.
 *
 * The FTShare text is free-form (`上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)`).
 * Anything outside 08:00–16:00 is discarded as a night session, then the
 * universal morning break is split out. Invalid text falls back to the
 * product default instead of guessing.
 */
export function parseDaySessions(tradeHours, product) {
    const text = (tradeHours ?? '').trim();
    if (text === '')
        return fallbackDaySessions(product);
    const ranges = [];
    for (const match of text.matchAll(RANGE)) {
        const [, sh, sm, eh, em] = match;
        const start = Number(sh) * HOUR + Number(sm) * MINUTE;
        const end = Number(eh) * HOUR + Number(em) * MINUTE;
        // Day only: drop 21:00–02:30 and anything else outside the daylight box.
        if (start < DAY_START || start >= DAY_END)
            continue;
        if (end <= DAY_START || end > DAY_END)
            continue;
        if (end - start < 5)
            continue;
        ranges.push({ start, end });
    }
    if (ranges.length === 0)
        return fallbackDaySessions(product);
    ranges.sort((a, b) => a.start - b.start);
    const deduped = [];
    for (const range of ranges) {
        const last = deduped[deduped.length - 1];
        if (last !== undefined && last.start === range.start && last.end === range.end)
            continue;
        deduped.push(range);
    }
    const windows = expandMorningBreak(deduped);
    if (!usableWindows(windows))
        return fallbackDaySessions(product);
    return { windows, source: 'trade-hours' };
}
/** Session table for a contract (or the uniform default when it has none). */
export function daySessionsFor(contract) {
    if (contract?.tradeHours !== undefined && contract.tradeHours.trim() !== '') {
        return parseDaySessions(contract.tradeHours, contract.product);
    }
    return fallbackDaySessions(contract?.product);
}
/**
 * Phase of the futures account clock.
 *
 * `tradeDate` is the account's current trade date; after 15:30 it already
 * points at the next trading day, which is why anything after the settlement
 * boundary reads `pre_open` rather than `closed`.
 */
export function phaseAt(nowIso, tradeDate, sessions) {
    if (tradeDate === '')
        return 'closed';
    const clock = shanghaiClock(nowIso);
    if (tradeDate > clock.date)
        return 'pre_open';
    if (tradeDate < clock.date)
        return 'closed';
    const minutes = clock.minutes;
    if (minutes < sessions.windows[0].start)
        return 'pre_open';
    for (const window of sessions.windows) {
        if (minutes >= window.start && minutes < window.end)
            return 'trading';
    }
    const last = sessions.windows[sessions.windows.length - 1];
    if (minutes >= last.end)
        return 'closed';
    return 'lunch';
}
/** Only continuous day trading accepts and matches orders (D1, limit included). */
export function canTrade(phase) {
    return phase === 'trading';
}
/** Next boundary inside the current trade date, or the next open when pre-open. */
export function nextBoundaryAt(nowIso, tradeDate, sessions) {
    const clock = shanghaiClock(nowIso);
    if (tradeDate > clock.date)
        return isoAtShanghai(tradeDate, OPEN_MINUTES);
    if (tradeDate < clock.date)
        return undefined;
    const starts = new Set();
    for (const window of sessions.windows) {
        starts.add(window.start);
        starts.add(window.end);
    }
    starts.add(SETTLEMENT_MINUTES);
    const upcoming = [...starts].filter(minute => minute > clock.minutes).sort((a, b) => a - b)[0];
    return upcoming === undefined ? undefined : isoAtShanghai(tradeDate, upcoming);
}
/** Shanghai wall-clock ISO of a minute on a date, for tests and the tick clock. */
export function isoAt(date, minutes) {
    return isoAtShanghai(date, minutes);
}
//# sourceMappingURL=session.js.map