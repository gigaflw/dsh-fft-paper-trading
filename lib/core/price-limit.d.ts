import type { Bar, PriceLimit } from '../contract.js';
/** Board ratio from the canonical symbol / ST marker; configurable in one place. */
export declare function limitRatioFor(symbol: string, name?: string): number;
export declare function priceLimitFor(symbol: string, name: string | undefined, prevClose: number | undefined): PriceLimit | undefined;
export declare function isWithinLimit(price: number, limit: PriceLimit | undefined): boolean;
/**
 * Previous close from a daily-bar series.
 *
 * FTShare keeps today's (possibly partial) bar in the series after the open, so
 * only bars before the current trade date qualify. A missing series leaves the
 * limit unknown, which the risk check treats as "no limit" rather than guessing.
 */
export declare function prevCloseFromBars(bars: readonly Bar[], today: string): number | undefined;
//# sourceMappingURL=price-limit.d.ts.map