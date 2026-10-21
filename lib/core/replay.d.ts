import type { AccountState, LedgerEvent } from './types.js';
export interface ReplayResult {
    state: AccountState;
    issues: string[];
}
/** Fold the event log into account state. Pure: no clock, no IO. */
export declare function replay(events: LedgerEvent[], accountId: string): ReplayResult;
//# sourceMappingURL=replay.d.ts.map