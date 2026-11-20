/**
 * Shared RPC scaffolding for every handler mounted on the paper-trading route.
 *
 * The stock, accounts, compare and futures handlers parse the same envelope and
 * answer with the same `{ ok, value | error }` shape; only the domain error
 * class differs. Keeping the guards here means one place decides what a
 * malformed payload looks like, instead of four drifting copies.
 * @module @dsh-ft/dsh-fft-paper-trading/service/rpc-support
 */

import type { RpcResult } from '../contract.js'

/** Success envelope. */
export const ok = <T>(value: T): RpcResult<T> => ({ ok: true, value })

/** Failure envelope with an explicit code (argument or routing problem). */
export const fail = (code: string, message: string): RpcResult<never> => ({
  ok: false,
  error: { code, message },
})

/**
 * Turn a thrown error into a failure envelope: domain errors keep their code,
 * anything else becomes INTERNAL with the original message.
 */
export function failure(error: unknown, isDomain: (error: unknown) => boolean): RpcResult<never> {
  if (isDomain(error)) {
    const domain = error as { code: string; message: string }
    return fail(domain.code, domain.message)
  }
  return fail('INTERNAL', error instanceof Error ? error.message : String(error))
}

/** Creates the domain error a guard should throw; the handler owns the class. */
export type ArgumentErrorFactory = (message: string) => Error

/**
 * Payload guards. `record` rejects non-objects; `allowEmpty` also accepts
 * `undefined`/`null` as an empty object (the futures handler's historical
 * contract for read endpoints).
 */
export function argumentGuards(makeError: ArgumentErrorFactory) {
  return {
    record(value: unknown, options: { allowEmpty?: boolean } = {}): Record<string, unknown> {
      if (value === undefined || value === null) {
        if (options.allowEmpty === true) return {}
        throw makeError('请求参数必须是对象')
      }
      if (typeof value !== 'object') throw makeError('请求参数必须是对象')
      return value as Record<string, unknown>
    },
    text(value: unknown, field: string): string {
      if (typeof value !== 'string' || value.trim() === '') throw makeError(`缺少 ${field}`)
      return value.trim()
    },
    num(value: unknown, field: string): number {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw makeError(`${field} 必须是数字`)
      return value
    },
  }
}
