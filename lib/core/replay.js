import { emptyState, applyEvent, verify } from './ledger.js';
/** Fold the event log into account state. Pure: no clock, no IO. */
export function replay(events, accountId) {
    const state = emptyState(accountId);
    for (const event of events) {
        if (state.accountId !== accountId)
            state.accountId = accountId;
        applyEvent(state, event);
    }
    return { state, issues: verify(state) };
}
//# sourceMappingURL=replay.js.map