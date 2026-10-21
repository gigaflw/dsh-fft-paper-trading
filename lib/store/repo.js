import { applyEvent, emptyState, verify } from '../core/ledger.js';
import { replay } from '../core/replay.js';
import { EventStore } from './event-store.js';
import { backupsDir, eventsPath } from './paths.js';
/** Loads, replays and appends the single account ledger. Writes are serialized. */
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
        let seqIssue;
        for (let i = 1; i < events.length; i += 1) {
            if (events[i].seq <= events[i - 1].seq) {
                seqIssue = `事件序号不连续: ${events[i - 1].seq} → ${events[i].seq}`;
                break;
            }
        }
        const result = replay(events, this.options.accountId);
        const issues = seqIssue === undefined ? result.issues : [seqIssue, ...result.issues];
        this.state = result.state;
        if (issues.length > 0 && !this.state.blocked) {
            await this.recordViolation(issues);
        }
        return this.state;
    }
    async recordViolation(issues) {
        const current = this.state ?? emptyState(this.options.accountId);
        const seq = current.lastSeq + 1;
        const event = {
            seq,
            id: `evt-${seq}`,
            ts: new Date().toISOString(),
            type: 'ledger.violation',
            payload: { check: 'replay', expected: 'consistent', actual: issues.join('; ') },
        };
        await this.store.append([event]);
        applyEvent(current, event);
        current.blocked = true;
        this.state = current;
        this.options.logger?.warn(`paper-trading: ledger violation, account blocked: ${issues.join('; ')}`);
    }
    async current() {
        return this.ensureLoaded();
    }
    async append(events) {
        return this.enqueue(async () => {
            const state = await this.ensureLoaded();
            if (events.length === 0)
                return state;
            await this.store.append(events);
            const next = state;
            for (const event of events)
                applyEvent(next, event);
            const issues = verify(next);
            this.state = next;
            if (issues.length > 0)
                await this.recordViolation(issues);
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
        const stamp = label.replace(/[:.]/g, '-');
        return this.store.backup(`${backupsDir(this.options.home, this.options.accountId)}/events-${stamp}.jsonl`);
    }
    enqueue(task) {
        const run = this.queue.then(task, task);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
}
//# sourceMappingURL=repo.js.map