/**
 * Futures replay: fold the append-only event log into account state.
 *
 * The same duplicate handling as the stock ledger is used — a killed process
 * or a repeated write can leave a byte-equivalent event twice, but a repeated
 * `seq` with different content is real corruption and must block the account.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/replay
 */
import type { FuturesAccountState, FuturesLedgerEvent } from './types.js';
export interface FuturesReplayResult {
    state: FuturesAccountState;
    issues: string[];
}
/** Fold the event log into account state. Pure: no clock, no IO. */
export declare function replayFutures(events: readonly FuturesLedgerEvent[], accountId: string): FuturesReplayResult;
export interface PreparedFuturesLedger {
    events: FuturesLedgerEvent[];
    duplicates: number;
    issues: string[];
}
/** Identity of one event for duplicate detection. */
export declare function futuresEventFingerprint(event: FuturesLedgerEvent): string;
/**
 * Split a ledger into a replayable event list, collapsing only identical
 * repeats of an already accepted event.
 */
export declare function prepareFuturesLedger(events: readonly FuturesLedgerEvent[]): PreparedFuturesLedger;
//# sourceMappingURL=replay.d.ts.map