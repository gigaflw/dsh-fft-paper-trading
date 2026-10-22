/**
 * Futures ledger repository: `$DSH_HOME/paper-trading/futures/events.jsonl`.
 *
 * Same durability model as the stock account — one write queue, contiguous
 * sequence numbers, fsync per append, atomic replacement for reset/repair, a
 * backup before any destructive operation, and automatic `blocked` state when
 * replay finds an inconsistency.
 *
 * @module @ft/dsh-fft-paper-trading/store/futures-repo
 */
import { resolve } from 'node:path';
import { FUTURES_ACCOUNT_ID } from '../futures-contract.js';
import { applyEvent, emptyState, verify } from '../core/futures/ledger.js';
import { quantizePrice } from '../core/futures/money.js';
import { prepareFuturesLedger, replayFutures, } from '../core/futures/replay.js';
import { EventStore } from './event-store.js';
import { backupsDir, eventsPath } from './paths.js';
/**
 * Loads, replays and appends the single futures ledger.
 *
 * Every write goes through one Promise queue and one sequence invariant, so a
 * concurrent read cannot duplicate a settlement event. Repairs and resets use
 * an atomic file replacement; a rejected write never touches the file.
 */
export class FuturesRepo {
    options;
    store;
    accountId;
    state;
    loading;
    queue = Promise.resolve();
    constructor(options) {
        this.options = options;
        this.accountId = options.accountId ?? FUTURES_ACCOUNT_ID;
        this.store = new EventStore(eventsPath(options.home, this.accountId));
    }
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
            this.options.logger?.warn(`paper-trading: dropped ${skipped} malformed futures ledger line(s)`);
        const prepared = prepareFuturesLedger(events);
        const source = prepared.issues.length > 0 ? events : prepared.events;
        const result = replayFutures(source, this.accountId);
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
            await this.store.backup(`${backupsDir(this.options.home, this.accountId)}/events-repair-${stamp}.jsonl`);
            await this.store.replace([...prepared.events, event]);
            applyEvent(state, event);
            this.options.logger?.warn(`paper-trading: dropped ${prepared.duplicates} duplicate futures ledger event(s)`);
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: futures ledger repair failed, kept in memory only: ${String(error)}`);
        }
        return state;
    }
    async recordViolation(issues) {
        const state = this.state;
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
        this.options.logger?.warn(`paper-trading: futures ledger violation, account blocked: ${issues.join('; ')}`);
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
                this.options.logger?.warn(`paper-trading: futures account blocked, dropped ${events.length} event(s)`);
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
     * Replace the file with a new ledger (reset, compaction). Validated and
     * replayed before the atomic rename, so a reset never leaves a ledger that
     * would lock the account on the next start.
     */
    async replace(events) {
        return this.enqueue(async () => {
            this.assertSequence(emptyState(this.accountId), events);
            const result = replayFutures([...events], this.accountId);
            if (result.issues.length > 0) {
                throw new Error(`paper-trading: refusing an inconsistent futures ledger: ${result.issues.join('; ')}`);
            }
            await this.ensureLoaded();
            await this.store.replace(events);
            this.state = result.state;
            this.loading = Promise.resolve(result.state);
            return this.state;
        });
    }
    /** Refresh position marks for the views only; never writes the ledger. */
    async markPrices(marks) {
        return this.enqueue(async () => {
            const state = await this.ensureLoaded();
            for (const mark of marks) {
                for (const position of Object.values(state.positions)) {
                    if (position.symbol !== mark.symbol)
                        continue;
                    if (!Number.isFinite(mark.last) || mark.last <= 0)
                        continue;
                    position.lastPrice = quantizePrice(mark.last, position.tickSize);
                }
            }
            return state;
        });
    }
    async backup(label) {
        return this.enqueue(async () => {
            const stamp = label.replace(/[:.]/g, '-');
            return this.store.backup(`${backupsDir(this.options.home, this.accountId)}/events-${stamp}.jsonl`);
        });
    }
    async readLedger() {
        return { path: resolve(this.store.filePath), content: await this.store.readText() };
    }
    assertSequence(state, events) {
        let expected = state.lastSeq + 1;
        for (const event of events) {
            if (!Number.isInteger(event.seq) || event.seq !== expected) {
                throw new Error(`paper-trading: futures ledger seq mismatch: expected ${expected}, got ${String(event.seq)}`);
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
//# sourceMappingURL=futures-repo.js.map