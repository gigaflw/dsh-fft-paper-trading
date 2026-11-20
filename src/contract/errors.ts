/**
 * Error codes surfaced through RpcFailure and the agent tools.
 * @module @dsh-ft/dsh-fft-paper-trading/contract/errors
 */

export type ErrorCode =
  | 'ACCOUNT_BLOCKED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_SYMBOL'
  | 'INVALID_QTY'
  | 'INVALID_LOT'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_POSITION'
  | 'T1_LOCKED'
  | 'MAX_NOTIONAL'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PENDING'
  | 'QUOTE_UNAVAILABLE'
  | 'SESSION_CLOSED'
  | 'AUCTION_ONLY'
  | 'PRICE_LIMIT'
  | 'SUSPENDED'
  | 'UNSUPPORTED_INSTRUMENT'
  | 'LEDGER_RESTORE_FAILED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_LIMIT'
  | 'ACCOUNT_LOCKED'