/**
 * Futures ledger repository: `$DSH_HOME/paper-trading/futures/events.jsonl`.
 *
 * Same durability model as the stock account — one write queue, contiguous
 * sequence numbers, fsync per append, atomic replacement for reset/repair, a
 * backup before any destructive operation, and automatic `blocked` state when
 * replay finds an inconsistency.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/store/futures-repo
 */
import type { FuturesAccountState, FuturesLedgerEvent } from '../core/futures/types.js';
export interface FuturesRepoOptions {
    home: string;
    accountId?: string;
    logger?: {
        warn(message: string): void;
    };
}
export interface FuturesTransaction<T> {
    events: FuturesLedgerEvent[];
    value: T;
}
export interface FuturesTransactionOutcome<T> {
    state: FuturesAccountState;
    value: T;
    /** Events that actually reached the file; empty when the store refused. */
    events: FuturesLedgerEvent[];
}
export interface FuturesLedgerFile {
    path: string;
    /** `null` when the ledger does not exist yet. */
    content: string | null;
}
/** Persistence port the futures service depends on. */
export interface FuturesStore {
    /** Absolute path of the event file when the store is file-backed. */
    readonly ledgerPath?: string;
    current(): Promise<FuturesAccountState>;
    transact<T>(build: (state: FuturesAccountState) => FuturesTransaction<T> | Promise<FuturesTransaction<T>>): Promise<FuturesTransactionOutcome<T>>;
    append(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>;
    replace(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>;
    /** Refresh the in-memory mark cache; quote ticks are not ledger events. */
    markPrices(marks: readonly {
        symbol: string;
        last: number;
    }[]): Promise<FuturesAccountState>;
    backup(label: string): Promise<boolean>;
    readLedger(): Promise<FuturesLedgerFile>;
}
/**
 * Loads, replays and appends the single futures ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a settlement event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 */
export declare class FuturesRepo implements FuturesStore {
    private readonly options;
    private readonly store;
    private readonly accountId;
    private state;
    private loading;
    private queue;
    constructor(options: FuturesRepoOptions);
    get ledgerPath(): string;
    private ensureLoaded;
    private loadOnce;
    private compact;
    private recordViolation;
    current(): Promise<FuturesAccountState>;
    transact<T>(build: (state: FuturesAccountState) => FuturesTransaction<T> | Promise<FuturesTransaction<T>>): Promise<FuturesTransactionOutcome<T>>;
    append(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>;
    /**
     * Replace the file with a new ledger (reset, compaction). Validated and
     * replayed before the atomic rename, so a reset never leaves a ledger that
     * would lock the account on the next start.
     */
    replace(events: readonly FuturesLedgerEvent[]): Promise<FuturesAccountState>;
    /** Refresh position marks for the views only; never writes the ledger. */
    markPrices(marks: readonly {
        symbol: string;
        last: number;
    }[]): Promise<FuturesAccountState>;
    backup(label: string): Promise<boolean>;
    readLedger(): Promise<FuturesLedgerFile>;
    private assertSequence;
    private enqueue;
}
//# sourceMappingURL=futures-repo.d.ts.map