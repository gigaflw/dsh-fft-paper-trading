/**
 * Internal types of the futures account.
 *
 * The cross-plane shapes (views, drafts, settings) live in
 * `src/futures-contract.ts` and are frozen; this module only adds the ledger's
 * own state and event payloads. Amounts are integer cents, prices are yuan
 * quantized to the contract tick.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/futures/types
 */
export function positionKey(symbol, side) {
    return `${symbol}|${side}`;
}
/** Market side of an order: open long buys, close long sells, and vice versa. */
export function tradeSideOf(offset, side) {
    return (offset === 'open') === (side === 'long') ? 'buy' : 'sell';
}
//# sourceMappingURL=types.js.map