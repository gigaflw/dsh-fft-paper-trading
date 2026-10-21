import { emptyState, applyEvent, verify } from './ledger.js'
import type { AccountState, LedgerEvent } from './types.js'

export interface ReplayResult {
  state: AccountState
  issues: string[]
}

/** Fold the event log into account state. Pure: no clock, no IO. */
export function replay(events: LedgerEvent[], accountId: string): ReplayResult {
  const state = emptyState(accountId)
  for (const event of events) {
    if (state.accountId !== accountId) state.accountId = accountId
    applyEvent(state, event)
  }
  return { state, issues: verify(state) }
}
