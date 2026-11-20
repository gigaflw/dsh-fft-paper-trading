import type { ErrorCode } from '../contract.js'

/** Everything a domain error may carry; `INTERNAL` is the only non-domain value. */
export type DomainErrorCode = ErrorCode | 'INTERNAL'

/**
 * The futures plane historically declared its own narrower code union; both
 * planes now answer from one closed set, and this alias keeps call sites and
 * tests compiling while the naming is retired gradually.
 */
export type FuturesServiceErrorCode = DomainErrorCode

/**
 * One typed failure for both trading planes.
 *
 * The RPC envelope always answers HTTP 200 with `{ ok: false, error }`; the
 * error carries the code and message, never an HTTP status (the old `status`
 * field was written at 96 call sites and read by nothing).
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/** Historical per-plane names for the same class; `instanceof` works for both. */
export { DomainError as PaperError, DomainError as FuturesError }
