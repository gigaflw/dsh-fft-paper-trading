/**
 * Round trips and market-data-source state.
 * @module @dsh-ft/dsh-fft-paper-trading/contract/market
 */

export type DataSourceState = 'configured' | 'free' | 'none' | 'invalid'

/**
 * Why the last market-data call failed, as a code the UI can act on.
 *
 * The upstream classification (`state` + `notice.code`) decides this. Text is
 * only read for one thing the codes cannot express: a spent quota shares its
 * code with a real outage, so the exhausted wording is matched instead.
 */
export type DataProblemReason =
  | 'no-key'
  | 'invalid-key'
  | 'plan-denied'
  | 'quota'
  | 'network'
  | 'upstream'

/** One observed data failure; the latest one drives the panel banner. */
export interface DataProblem {
  reason: DataProblemReason
  /** Readable upstream cause, already trimmed for display. */
  message: string
  /** ISO-8601 time of the observation. */
  at: string
}

/** Read-only data-source state for the panel header; never carries the key itself. */
export interface DataSourceStatus {
  state: DataSourceState
  /** Short, user-facing cause for `invalid` or a degraded `configured`. */
  message?: string
  /** Latest observed data failure, cleared by the next successful quote call. */
  problem?: DataProblem
}