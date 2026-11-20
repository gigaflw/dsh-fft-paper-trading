/**
 * RPC envelope shared by the browser and host halves.
 * @module @dsh-ft/dsh-fft-paper-trading/contract/rpc
 */

export interface RpcSuccess<T> { ok: true; value: T }
export interface RpcFailure { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
export type RpcResult<T> = RpcSuccess<T> | RpcFailure

export interface RpcRequest {
  endpoint: string
  payload?: unknown
  /** Target account id or display name; omitted means the kind's default account. */
  account?: string
}