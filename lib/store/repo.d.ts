import type { Quote } from '../contract.js';
import type { AccountState, LedgerEvent } from '../core/types.js';
import type { AccountStore } from './port.js';
export interface RepoOptions {
    home: string;
    accountId: string;
    logger?: {
        warn(message: string): void;
    };
}
/** Loads, replays and appends the single account ledger. Writes are serialized. */
export declare class AccountRepo implements AccountStore {
    private readonly options;
    private readonly store;
    private state;
    private loading;
    private queue;
    constructor(options: RepoOptions);
    private ensureLoaded;
    private loadOnce;
    private recordViolation;
    current(): Promise<AccountState>;
    append(events: readonly LedgerEvent[]): Promise<AccountState>;
    /** Refresh the in-memory mark-to-market cache; quote ticks are not ledger events. */
    markPrices(quotes: readonly Quote[]): Promise<AccountState>;
    /** Copy the event file into `backups/`, named after the reset timestamp. */
    backup(label: string): Promise<boolean>;
    private enqueue;
}
//# sourceMappingURL=repo.d.ts.map