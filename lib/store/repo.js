import { resolve } from 'node:path';
import { applyEvent, emptyState, verify } from '../core/ledger.js';
import { prepareLedger, replay } from '../core/replay.js';
import { EventStore } from './event-store.js';
import { backupsDir, eventsPath } from './paths.js';
/**
 * Loads, replays and appends the single account ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a day-boundary event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 */
export class AccountRepo {
    options;
    store;
    state;
    loading;
    queue = Promise.resolve();
    constructor(options) {
        this.options = options;
        this.store = new EventStore(eventsPath(options.home, options.accountId));
    }
    /** Absolute path of `events.jsonl`, surfaced so a locked account is fixable. */
    get ledgerPath() {
        return this.store.filePath;
    }
    async ensureLoaded() {
        if (this.state !== undefined)
            return this.state;
        if (this.loading === undefined)
            this.loading = this.loadOnce();
        return this.loading;
    }
    async loadOnce() {
        const { events, skipped } = await this.store.readAll();
        if (skipped > 0)
            this.options.logger?.warn(`paper-trading: dropped ${skipped} malformed ledger line(s)`);
        const prepared = prepareLedger(events);
        // Conflicting same-seq events are real corruption: replay the original file
        // untouched so the violation reports what is actually there.
        const source = prepared.issues.length > 0 ? events : prepared.events;
        const result = replay(source, this.options.accountId);
        let state = result.state;
        if (prepared.issues.length === 0 && prepared.duplicates > 0) {
            state = await this.compact(prepared, state);
        }
        this.state = state;
        const issues = [...prepared.issues, ...result.issues];
        if (issues.length > 0 && !state.blocked)
            await this.recordViolation(issues);
        return this.state;
    }
    /**
     * Drop repeated events from the file and leave one `ledger.repaired` marker.
     *
     * Only reached when every duplicate was byte-equivalent apart from its
     * `recordedAt` stamp, so the account values themselves are untouched.
     */
    async compact(prepared, state) {
        const seq = state.lastSeq + 1;
        const event = {
            seq,
            id: `evt-${seq}`,
            ts: new Date().toISOString(),
            type: 'ledger.repaired',
            payload: { dropped: prepared.duplicates },
        };
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try {
            await this.store.backup(`${backupsDir(this.options.home, this.options.accountId)}/events-repair-${stamp}.jsonl`);
            await this.store.replace([...prepared.events, event]);
            applyEvent(state, event);
            this.options.logger?.warn(`paper-trading: dropped ${prepared.duplicates} duplicate ledger event(s)`);
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: ledger repair failed, kept in memory only: ${String(error)}`);
        }
        return state;
    }
    async recordViolation(issues) {
        const state = this.state;
        // A blocked account never grows its ledger: a new violation per tick would
        // bury the original evidence under thousands of identical events.
        if (state === undefined || state.blocked)
            return;
        const seq = state.lastSeq + 1;
        const event = {
            seq,
            id: `evt-${seq}`,
            ts: new Date().toISOString(),
            type: 'ledger.violation',
            payload: { check: 'replay', expected: 'consistent', actual: issues.join('; ') },
        };
        await this.store.append([event]);
        applyEvent(state, event);
        this.state = state;
        this.options.logger?.warn(`paper-trading: ledger violation, account blocked: ${issues.join('; ')}`);
    }
    async current() {
        return this.ensureLoaded();
    }
    async transact(build) {
        return this.enqueue(async () => {
            const state = await this.ensureLoaded();
            const built = await build(state);
            const events = built.events;
            if (events.length === 0)
                return { state, value: built.value, events };
            if (state.blocked) {
                this.options.logger?.warn(`paper-trading: account blocked, dropped ${events.length} event(s)`);
                return { state, value: built.value, events: [] };
            }
            this.assertSequence(state, events);
            await this.store.append(events);
            for (const event of events)
                applyEvent(state, event);
            const issues = verify(state);
            this.state = state;
            if (issues.length > 0)
                await this.recordViolation(issues);
            return { state: this.state ?? state, value: built.value, events };
        });
    }
    async append(events) {
        const outcome = await this.transact(() => ({ events: [...events], value: undefined }));
        return outcome.state;
    }
    /**
     * Replace the file with a new ledger (reset, compaction).
     *
     * The replacement is validated and replayed before the atomic rename, so a
     * reset never leaves a ledger that would lock the account on the next start.
     */
    async replace(events) {
        return this.enqueue(async () => {
            this.assertSequence(emptyState(this.options.accountId), events);
            const result = replay([...events], this.options.accountId);
            if (result.issues.length > 0) {
                throw new Error(`paper-trading: refusing an inconsistent ledger: ${result.issues.join('; ')}`);
            }
            // Settle any in-flight load first: it may still repair or block the old file.
            await this.ensureLoaded();
            await this.store.replace(events);
            this.state = result.state;
            this.loading = Promise.resolve(result.state);
            return this.state;
        });
    }
    /** Refresh the in-memory mark-to-market cache; quote ticks are not ledger events. */
    async markPrices(quotes) {
        return this.enqueue(async () => {
            const state = await this.ensureLoaded();
            for (const quote of quotes) {
                const position = state.positions[quote.symbol];
                if (position !== undefined) {
                    position.lastPrice = quote.last;
                    position.lastTs = quote.ts;
                }
            }
            return state;
        });
    }
    /** Copy the event file into `backups/`, named after the reset timestamp. */
    async backup(label) {
        return this.enqueue(async () => {
            const stamp = label.replace(/[:.]/g, '-');
            return this.store.backup(`${backupsDir(this.options.home, this.options.accountId)}/events-${stamp}.jsonl`);
        });
    }
    /** Raw file text for `account/export`; `content: null` means "not created yet". */
    async readLedger() {
        return { path: resolve(this.store.filePath), content: await this.store.readText() };
    }
    assertSequence(state, events) {
        let expected = state.lastSeq + 1;
        for (const event of events) {
            if (!Number.isInteger(event.seq) || event.seq !== expected) {
                throw new Error(`paper-trading: ledger seq mismatch: expected ${expected}, got ${String(event.seq)}`);
            }
            expected += 1;
        }
    }
    enqueue(task) {
        const run = this.queue.then(task, task);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
}
//# sourceMappingURL=repo.js.map