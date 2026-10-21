/** Money helpers. Amounts are integer cents; prices are yuan rounded to 0.01. */
export declare function roundPrice(price: number): number;
export declare function amountCents(price: number, qty: number): number;
/** Apply slippage to one side of a quote. */
export declare function slipped(price: number, side: 'buy' | 'sell', bps: number): number;
//# sourceMappingURL=money.d.ts.map