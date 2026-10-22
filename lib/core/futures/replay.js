/**
 * Futures replay: fold the append-only event log into account state.
 *
 * The same duplicate handling as the stock ledger is used — a killed process
 * or a repeated write can leave a byte-equivalent event twice, but a repeated
 * `seq` with different content is real corruption and must block the account.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/replay
 */
import { applyEvent, emptyState, verify } from './ledger.js';
/** Fold the event log into account state. Pure: no clock, no IO. */
export function replayFutures(events, accountId) {
    const state = emptyState(accountId);
    for (const event of events) {
        if (state.accountId !== accountId)
            state.accountId = accountId;
        applyEvent(state, event);
    }
    return { state, issues: verify(state) };
}
/** Identity of one event for duplicate detection. */
export function futuresEventFingerprint(event) {
    const payload = { ...event.payload };
    delete payload.recordedAt;
    const point = payload;
    if (Array.isArray(point.positions)) {
        point.positions = point.positions.map(position => {
            const copy = { ...position };
            delete copy.recordedAt;
            return copy;
        });
    }
    return JSON.stringify({ type: event.type, payload });
}
/**
 * Split a ledger into a replayable event list, collapsing only identical
 * repeats of an already accepted event.
 */
export function prepareFuturesLedger(events) {
    const kept = [];
    const bySeq = new Map();
    const issues = [];
    let duplicates = 0;
    for (const event of events) {
        if (!Number.isInteger(event.seq) || event.seq <= 0) {
            issues.push(`事件序号非法: ${String(event.seq)}`);
            continue;
        }
        const last = kept[kept.length - 1];
        if (last === undefined || event.seq > last.seq) {
            kept.push(event);
            bySeq.set(event.seq, event);
            continue;
        }
        const known = bySeq.get(event.seq);
        if (known !== undefined && futuresEventFingerprint(known) === futuresEventFingerprint(event)) {
            duplicates += 1;
            continue;
        }
        if (known !== undefined)
            issues.push(`事件序号重复且内容不同: ${event.seq}`);
        else
            issues.push(`事件序号不连续: ${last.seq} → ${event.seq}`);
    }
    return { events: kept, duplicates, issues };
}
//# sourceMappingURL=replay.js.map