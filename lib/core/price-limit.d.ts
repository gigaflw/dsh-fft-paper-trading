import type { PriceLimit } from '../contract.js';
/** Board ratio from the symbol prefix / ST marker; configurable in one place. */
export declare function limitRatioFor(symbol: string, name?: string): number;
export declare function priceLimitFor(symbol: string, name: string | undefined, prevClose: number | undefined): PriceLimit | undefined;
export declare function isWithinLimit(price: number, limit: PriceLimit | undefined): boolean;
//# sourceMappingURL=price-limit.d.ts.map