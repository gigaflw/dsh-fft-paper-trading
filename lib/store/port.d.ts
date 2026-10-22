import type { Quote } from '../contract.js';
import type { AccountState, LedgerEvent } from '../core/types.js';
/**
 * Persistence port owned by the service.
 *
 * The service never learns how state is stored: {@link AccountRepo} is the JSONL
 * adapter today, and a test fake or another backend only has to replay the same
 * events. `markPrices` is deliberately not a ledger event — quotes feed
 * mark-to-market views, but the auditable history is still the event log.
 */
export interface AccountStore {
    /** Absolute path of the event file when the store is file-backed. */
    readonly ledgerPath?: string;
    /** Replay the log once and return the current state. */
    current(): Promise<AccountState>;
    /**
     * Build events from the freshest state and append them atomically.
     *
     * This is the only safe way to write a clock advance: `build` runs inside the
     * store's write queue, so concurrent readers each see the state left by the
     * previous transaction and cannot generate the same sequence twice.
     */
    transact<T>(build: (state: AccountState) => Transaction<T> | Promise<Transaction<T>>): Promise<TransactionOutcome<T>>;
    /** Append a batch built elsewhere; the store still enforces seq continuity. */
    append(events: readonly LedgerEvent[]): Promise<AccountState>;
    /** Atomically replace the whole ledger (compaction, reset) and the state. */
    replace(events: readonly LedgerEvent[]): Promise<AccountState>;
    /** Refresh the quote cache used by views; never writes the ledger. */
    markPrices(quotes: readonly Quote[]): Promise<AccountState>;
    /** Copy the event file aside before a destructive operation. */
    backup(label: string): Promise<boolean>;
    /** Raw ledger text plus its absolute path, for `account/export`. */
    readLedger(): Promise<LedgerFile>;
}
export interface Transaction<T> {
    events: LedgerEvent[];
    value: T;
}
export interface TransactionOutcome<T> {
    state: AccountState;
    value: T;
    /** Events that actually reached the file; empty when the store refused. */
    events: LedgerEvent[];
}
export interface LedgerFile {
    path: string;
    /** `null` when the ledger does not exist yet. */
    content: string | null;
}
//# sourceMappingURL=port.d.ts.map