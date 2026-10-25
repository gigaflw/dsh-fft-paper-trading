/**
 * Futures money helpers.
 *
 * Prices are yuan quantized to the contract tick; amounts are integer cents.
 * Every derived amount is rounded once, at the point it becomes cents, so
 * replay and preview agree exactly.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/futures/money
 */
/** Decimal places carried by a tick size (0.005 → 3, 0.2 → 1, 2 → 0). */
export declare function decimalsOf(value: number): number;
/**
 * Quantize a price to the contract tick.
 *
 * Integer scaling avoids the classic `0.005 × 3 = 0.015` float drift that
 * would make a fill price differ from its preview.
 */
export declare function quantizePrice(price: number, tickSize: number): number;
/** Notional in cents: price × multiplier × lots. */
export declare function amountCents(price: number, multiplier: number, qty: number): number;
export declare function roundCents(value: number): number;
export declare function centsToYuan(cents: number): number;
export declare function isPositiveNumber(value: unknown): value is number;
//# sourceMappingURL=money.d.ts.map