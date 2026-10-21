import type { AccountState, LedgerEvent } from './types.js';
export declare function emptyState(accountId: string): AccountState;
/** Apply one ledger event in place. Callers own cloning. */
export declare function applyEvent(state: AccountState, event: LedgerEvent): AccountState;
/** Structural invariants checked after replay and before every write. */
export declare function verify(state: AccountState): string[];
//# sourceMappingURL=ledger.d.ts.map