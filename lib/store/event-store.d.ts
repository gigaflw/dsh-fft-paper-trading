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
    private ensureDir;
    append(events: readonly LedgerEvent[]): Promise<void>;
    readAll(): Promise<ReadResult>;
    backup(destination: string): Promise<boolean>;
}
//# sourceMappingURL=event-store.d.ts.map