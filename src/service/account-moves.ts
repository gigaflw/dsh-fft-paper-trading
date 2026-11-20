/**
 * Opening and cash moves, shared by the stock and futures services.
 *
 * Both planes keep the same rules — open once on first read, re-check cash
 * inside the write transaction, and surface a frozen ledger before anything
 * else. The only differences are the engine functions, the state type and the
 * view builder, which each service passes in. After the error-model unification
 * the failure types are identical too, so the logic lives here once.
 * @module @dsh-ft/dsh-fft-paper-trading/service/account-moves
 */

import { DomainError } from './errors.js'

export interface MoveCashDeps<S, V, E> {
  sync(): Promise<S>
  transact<T>(build: (state: S) => { events: E[]; value: T } | Promise<{ events: E[]; value: T }>): Promise<{ state: S; value: T }>
  isBlocked(state: S): boolean
  /** Plane-specific "account frozen" error, with its reason. */
  blocked(state: S): Error
  cashCents(state: S): number
  deposit(state: S, amountCents: number, ts: string): { events: E[] }
  withdraw(state: S, amountCents: number, ts: string): { events: E[] }
  viewOf(state: S): V
  ts(): string
}

/**
 * Deposit or withdraw cash (amount already converted to cents).
 *
 * The balance is re-checked inside the transaction: a concurrent buy or a
 * margin reservation may have spent the cash between `sync()` and this write.
 */
export async function moveCash<S, V, E>(
  deps: MoveCashDeps<S, V, E>,
  kind: 'deposit' | 'withdraw',
  amountCents: number,
): Promise<V> {
  const state = await deps.sync()
  if (deps.isBlocked(state)) throw deps.blocked(state)
  const outcome = await deps.transact<{ blocked: boolean; insufficient: boolean }>(current => {
    if (deps.isBlocked(current)) return { events: [], value: { blocked: true, insufficient: false } }
    if (kind === 'withdraw' && amountCents > deps.cashCents(current)) {
      return { events: [], value: { blocked: false, insufficient: true } }
    }
    const ts = deps.ts()
    const result = kind === 'deposit' ? deps.deposit(current, amountCents, ts) : deps.withdraw(current, amountCents, ts)
    return { events: result.events, value: { blocked: false, insufficient: false } }
  })
  if (outcome.value.blocked === true) throw deps.blocked(outcome.state)
  if (outcome.value.insufficient === true) throw new DomainError('INSUFFICIENT_CASH', '可提现金不足')
  return deps.viewOf(outcome.state)
}

export interface OpenAccountDeps<S, E> {
  transact<T>(build: (state: S) => { events: E[]; value: T } | Promise<{ events: E[]; value: T }>): Promise<{ state: S; value: T }>
  hasAccount(state: S): boolean
  tradeDateForNow(): Promise<string>
  /** Plane-specific genesis: `openAccount` returns the events to append. */
  open(state: S, tradeDate: string, ts: string): { events: E[] }
  now(): Date
}

/** Open the ledger on first read; a no-op afterwards. */
export async function openAccountOnce<S, E>(deps: OpenAccountDeps<S, E>): Promise<S> {
  const outcome = await deps.transact(async state => {
    if (deps.hasAccount(state)) return { events: [], value: undefined }
    const tradeDate = await deps.tradeDateForNow()
    const result = deps.open(state, tradeDate, deps.now().toISOString())
    return { events: result.events, value: undefined }
  })
  return outcome.state
}
