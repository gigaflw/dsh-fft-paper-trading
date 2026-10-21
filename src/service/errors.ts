import type { ErrorCode } from '../contract.js'

export class PaperError extends Error {
  constructor(
    readonly code: ErrorCode | 'INTERNAL',
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'PaperError'
  }
}
