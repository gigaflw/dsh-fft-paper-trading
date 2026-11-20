/**
 * The one failure shape every tool returns.
 *
 * Tools must never throw at the model: a failure is a normal result with a
 * readable summary and a machine-readable `data.error`. The stock and futures
 * tools used to carry near-identical copies of this function; the ledger tool's
 * duck-typed variant is folded in here, so a coded error and a plain exception
 * are rendered the same way everywhere.
 * @module @dsh-ft/dsh-fft-paper-trading/agent/tool-result
 */

export interface ToolFailure {
  summary: string
  data: { error: unknown }
}

/** Render any thrown value as the tool failure envelope. */
export function toolFailure(error: unknown): ToolFailure {
  const coded = error as { code?: unknown; message?: unknown }
  if (typeof coded?.code === 'string') {
    const code = coded.code
    const message = String(coded.message ?? '')
    return { summary: `失败：${code} ${message}`, data: { error: { code, message } } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { summary: `失败：${message}`, data: { error: String(error) } }
}
