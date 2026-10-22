/**
 * Commodity futures day session.
 *
 * MVP scope (D1): day session only — 09:00–11:30 with the 10:15–10:30 break and
 * 13:30–15:00. No night session, no CFFEX/国债 special hours. Ranges come from
 * the contract's `trade_hours_info` when it parses, with a uniform commodity
 * fallback when it does not.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/session
 */
import type { FuturesPhase } from '../../futures-contract.js';
export interface DayWindow {
    /** Minutes since midnight, Asia/Shanghai. */
    start: number;
    end: number;
}
export interface DaySessions {
    windows: readonly DayWindow[];
    source: 'trade-hours' | 'fallback';
}
/** 15:30 close + settlement, when the trade date advances (D1). */
export declare const SETTLEMENT_MINUTES: number;
export declare const OPEN_MINUTES: number;
/** Uniform session of the five commodity exchanges when the text is unusable. */
export declare const DEFAULT_DAY_WINDOWS: readonly DayWindow[];
/** Uniform commodity fallback, with a product override hook. */
export declare function fallbackDaySessions(product?: string): DaySessions;
/**
 * Parse the day ranges out of `trade_hours_info`.
 *
 * The FTShare text is free-form (`上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)`).
 * Anything outside 08:00–16:00 is discarded as a night session, then the
 * universal morning break is split out. Invalid text falls back to the
 * product default instead of guessing.
 */
export declare function parseDaySessions(tradeHours: string | undefined, product?: string): DaySessions;
/** Session table for a contract (or the uniform default when it has none). */
export declare function daySessionsFor(contract: {
    tradeHours?: string;
    product?: string;
} | undefined): DaySessions;
/**
 * Phase of the futures account clock.
 *
 * `tradeDate` is the account's current trade date; after 15:30 it already
 * points at the next trading day, which is why anything after the settlement
 * boundary reads `pre_open` rather than `closed`.
 */
export declare function phaseAt(nowIso: string, tradeDate: string, sessions: DaySessions): FuturesPhase;
/** Only continuous day trading accepts and matches orders (D1, limit included). */
export declare function canTrade(phase: FuturesPhase): boolean;
/** Next boundary inside the current trade date, or the next open when pre-open. */
export declare function nextBoundaryAt(nowIso: string, tradeDate: string, sessions: DaySessions): string | undefined;
/** Shanghai wall-clock ISO of a minute on a date, for tests and the tick clock. */
export declare function isoAt(date: string, minutes: number): string;
//# sourceMappingURL=session.d.ts.map