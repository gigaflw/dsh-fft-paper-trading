/**
 * Futures ledger fold and invariants.
 *
 * Cash is free cash: opening a position reserves margin out of it, closing
 * releases margin back plus the realized PnL. Therefore
 *
 *   equity = cash + margin + unrealized(float)
 *
 * is an identity, while cash itself is only ever moved by fills and fees —
 * which is what makes replay exact without storing quote marks.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/ledger
 */
import { type FuturesSettings } from '../../futures-contract.js';
import { type FuturesAccountState, type FuturesLedgerEvent } from './types.js';
/**
 * Merge persisted settings over the defaults. A hand-edited or legacy ledger
 * must never install a partial settings object: `undefined × price` would make
 * every later margin calculation NaN and block the account on the next load.
 */
export declare function normalizeFuturesSettings(persisted: unknown): FuturesSettings;
export declare function emptyState(accountId: string): FuturesAccountState;
/** Apply one ledger event in place. Callers own cloning. */
export declare function applyEvent(state: FuturesAccountState, event: FuturesLedgerEvent): FuturesAccountState;
/**
 * Structural invariants checked after replay and after every write.
 *
 * Cash and margin are recomputed from the fill log: a duplicated fill, a
 * missing release or a drifted position is caught here and blocks the account
 * instead of silently producing a wrong equity.
 */
export declare function verify(state: FuturesAccountState): string[];
//# sourceMappingURL=ledger.d.ts.map