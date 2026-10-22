import type { Quote } from '../contract.js';
import type { AccountState, LedgerEvent } from '../core/types.js';
import type { AccountStore, LedgerFile, Transaction, TransactionOutcome } from './port.js';
export interface RepoOptions {
    home: string;
    accountId: string;
    logger?: {
        warn(message: string): void;
    };
}
/**
 * Loads, replays and appends the single account ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a day-boundary event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 */
export declare class AccountRepo implements AccountStore {
    private readonly options;
    private readonly store;
    private state;
    private loading;
    private queue;
    constructor(options: RepoOptions);
    /** Absolute path of `events.jsonl`, surfaced so a locked account is fixable. */
    get ledgerPath(): string;
    private ensureLoaded;
    private loadOnce;
    /**
     * Drop repeated events from the file and leave one `ledger.repaired` marker.
     *
     * Only reached when every duplicate was byte-equivalent apart from its
     * `recordedAt` stamp, so the account values themselves are untouched.
     */
    private compact;
    private recordViolation;
    current(): Promise<AccountState>;
    transact<T>(build: (state: AccountState) => Transaction<T> | Promise<Transaction<T>>): Promise<TransactionOutcome<T>>;
    append(events: readonly LedgerEvent[]): Promise<AccountState>;
    /**
     * Replace the file with a new ledger (reset, compaction).
     *
     * The replacement is validated and replayed before the atomic rename, so a
     * reset never leaves a ledger that would lock the account on the next start.
     */
    replace(events: readonly LedgerEvent[]): Promise<AccountState>;
    /** Refresh the in-memory mark-to-market cache; quote ticks are not ledger events. */
    markPrices(quotes: readonly Quote[]): Promise<AccountState>;
    /** Copy the event file into `backups/`, named after the reset timestamp. */
    backup(label: string): Promise<boolean>;
    /** Raw file text for `account/export`; `content: null` means "not created yet". */
    readLedger(): Promise<LedgerFile>;
    private assertSequence;
    private enqueue;
}
//# sourceMappingURL=repo.d.ts.map