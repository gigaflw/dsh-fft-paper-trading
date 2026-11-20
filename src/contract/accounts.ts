/**
 * Account registry and comparison shapes (multi-account).
 * @module @dsh-ft/dsh-fft-paper-trading/contract/accounts
 */

import type { EquityPoint } from './domain.js'

/** Asset families that own their own ledger. v1 only grows `stock`. */
export type AccountKind = 'stock' | 'futures'

/**
 * One account's free-form notes.
 *
 * A single large text block the human rewrites however they like — not a log,
 * no timestamps, never written by the model. Stored beside the ledger so the
 * registry file stays small.
 */
export interface NoteView {
  text: string
  /** ISO time of the last write, absent when the account has no note yet. */
  updatedAt?: string
  bytes: number
  maxBytes: number
}

/**
 * Registry entry for one ledger directory.
 *
 * `id` is the on-disk directory name and never changes; `name` is the
 * user-editable display name and may repeat — `id` is the only reliable handle.
 * `initialCashCents` is a creation intent kept until the account's first
 * `account.opened` event has recorded it in the ledger.
 *
 * There is deliberately no session, model or owner field: this plugin knows
 * nothing about sessions, and any caller may address any account.
 */
export interface AccountMeta {
  id: string
  kind: AccountKind
  name: string
  createdAt: string
  /** Hidden from the panel picker and the comparison page; still addressable by id. */
  hidden: boolean
  /** Locked accounts refuse state changes (orders, reset, cash, ledger restore). */
  locked: boolean
  initialCashCents?: number
  /** The ledger directory vanished while the registry still lists the entry. */
  missing?: boolean
}

/** One row of the comparison page: enough to draw a curve and rank by return. */
export interface CompareRow {
  id: string
  name: string
  locked: boolean
  missing?: boolean
  initialCash: number
  equity: number
  pnl: number
  pnlPct: number
  todayPnl: number
  maxDrawdownPct: number
  tradeCount: number
  /** Daily equity snapshots, oldest first; the client normalises before plotting. */
  points: EquityPoint[]
}

/** `compare/get` payload: one row per visible account, unsorted. */
export interface CompareView {
  accounts: CompareRow[]
}

/** `accounts/list` payload: the registry plus the defaults the panel needs. */
export interface AccountsView {
  accounts: AccountMeta[]
  /** Default account id per kind, e.g. `{ stock: 'default', futures: 'futures' }`. */
  defaultIds: Record<AccountKind, string>
  tickMs: number
}