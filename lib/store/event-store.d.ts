import type { LedgerEvent } from '../core/types.js';
export interface ReadResult {
    events: LedgerEvent[];
    /** Malformed tail lines that were dropped (a killed process can leave one). */
    skipped: number;
}
/** Append-only JSONL store. Every append is flushed with fsync. */
export declare class EventStore {
    private readonly file;
    constructor(file: string);
    /** Absolute path of the ledger file, for export and diagnostics. */
    get filePath(): string;
    private ensureDir;
    append(events: readonly LedgerEvent[]): Promise<void>;
    readAll(): Promise<ReadResult>;
    /**
     * Replace the whole file atomically: write a sibling temp file, fsync it and
     * rename over the target. A crash leaves either the old or the new ledger,
     * never a half-written one.
     */
    replace(events: readonly LedgerEvent[]): Promise<void>;
    /** Raw file text; `null` when the ledger has not been created yet. */
    readText(): Promise<string | null>;
    backup(destination: string): Promise<boolean>;
}
//# sourceMappingURL=event-store.d.ts.map