/**
 * Basket allocation: CSV → parse → budget split into 100-share lots.
 *
 * Everything here is a pure function over its input (no ledger, no clock, no
 * market data); the service owns IO and error codes. That keeps the fee, lot
 * and normalisation rules in one testable place and lets the preview and the
 * eventual agent tool share the exact same arithmetic.
 * @module @dsh-ft/dsh-fft-paper-trading/core/basket
 */
import type { BasketIssue, BasketPlanRow, PaperSettings, Quote } from '../contract.js';
/** v1 cap: a basket is read at a glance and quotes are fetched one by one. */
export declare const MAX_BASKET_SYMBOLS = 20;
/** One parsed CSV row before allocation. */
export interface BasketCsvRow {
    symbol: string;
    /** Normalised across the file, so the weights sum to 1. */
    weight: number;
}
/** `parseBasketCsv` output: usable rows plus per-line problems and hints. */
export interface BasketParseResult {
    rows: BasketCsvRow[];
    issues: BasketIssue[];
    warnings: string[];
}
/** Inputs of `allocateBasket`. */
export interface BasketAllocationInput {
    rows: readonly BasketCsvRow[];
    /** Live quotes for the parsed symbols; a missing symbol becomes `no_quote`. */
    quotes: readonly Quote[];
    /** Effective budget in cents: min(user input, available cash). */
    budgetCents: number;
    /** Available cash before the basket, used for `cashAfterCents`. */
    cashCents: number;
    settings: PaperSettings;
}
/** Allocation without the parse/session parts the service adds. */
export interface BasketAllocation {
    budgetCents: number;
    rows: BasketPlanRow[];
    warnings: string[];
    totalAmountCents: number;
    totalFeesCents: number;
    residualCents: number;
    cashAfterCents: number;
}
/**
 * Parse the two-column CSV format.
 *
 * Problems never throw: every bad line becomes a `BasketIssue` so the client can
 * show the rest of the file, while a basket over 20 symbols is rejected as a
 * whole (truncating silently would place a basket the user did not ask for).
 */
export declare function parseBasketCsv(csv: string): BasketParseResult;
/**
 * Split the budget across the parsed rows.
 *
 * Symbols without a usable quote are dropped from the allocation and their
 * budget stays in cash instead of being re-spread: the user asked for those
 * weights, not for the largest names to be bought with the leftover.
 */
export declare function allocateBasket(input: BasketAllocationInput): BasketAllocation;
//# sourceMappingURL=basket.d.ts.map