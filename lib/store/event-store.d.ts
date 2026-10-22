import type { LedgerEvent } from '../core/types.js';
export interface ReadResult<T> {
    events: T[];
    /** Malformed tail lines that were dropped (a killed process can leave one). */
    skipped: number;
}
/** The only fields the store needs; both the stock and futures ledgers satisfy it. */
export interface StoredLedgerEvent {
    seq: number;
    type: string;
}
/**
 * Append-only JSONL store. Every append is flushed with fsync.
 *
 * Generic over the event union so the stock and futures ledgers share the
 * atomic write/read/backup implementation without sharing an event schema.
 * The default parameter keeps every existing stock call site unchanged.
 */
export declare class EventStore<T extends StoredLedgerEvent = LedgerEvent> {
    private readonly file;
    constructor(file: string);
    /** Absolute path of the ledger file, for export and diagnostics. */
    get filePath(): string;
    private ensureDir;
    append(events: readonly T[]): Promise<void>;
    readAll(): Promise<ReadResult<T>>;
    /**
     * Replace the whole file atomically: write a sibling temp file, fsync it and
     * rename over the target. A crash leaves either the old or the new ledger,
     * never a half-written one.
     */
    replace(events: readonly T[]): Promise<void>;
    /** Raw file text; `null` when the ledger has not been created yet. */
    readText(): Promise<string | null>;
    backup(destination: string): Promise<boolean>;
}
//# sourceMappingURL=event-store.d.ts.map