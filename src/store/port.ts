import type { Quote } from '../contract.js'
import type { AccountState, LedgerEvent } from '../core/types.js'

/**
 * Persistence port owned by the service.
 *
 * The service never learns how state is stored: {@link AccountRepo} is the JSONL
 * adapter today, and a test fake or another backend only has to replay the same
 * events. `markPrices` is deliberately not a ledger event — quotes feed
 * mark-to-market views, but the auditable history is still the event log.
 */
export interface AccountStore {
  /** Replay the log once and return the current state. */
  current(): Promise<AccountState>
  /** Append a batch of events and fold them into the in-memory state. */
  append(events: readonly LedgerEvent[]): Promise<AccountState>
  /** Refresh the quote cache used by views; never writes the ledger. */
  markPrices(quotes: readonly Quote[]): Promise<AccountState>
  /** Copy the event file aside before a destructive reset. */
  backup(label: string): Promise<boolean>
}
