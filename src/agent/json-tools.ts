/**
 * Tool-result normalization for DSH's JSON boundary.
 *
 * DSH materializes every tool output through a lossless-JSON snapshot, which
 * rejects `undefined` object properties, non-finite numbers and class
 * instances. The domain views are TypeScript-optional (`accountId`,
 * `blockedReason`, `preview.quote`, `preview.priceLimit`, `preview.session`,
 * ...), so those keys exist with `undefined` and the whole call failed with
 * "value is not lossless JSON".
 *
 * The panel reaches the same views through the RPC transport, where
 * `JSON.stringify` already drops those keys. Normalizing here keeps the agent
 * tools and the panel on one shape.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/agent/json-tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Detach a value into plain JSON: absent optionals stay absent, NaN/Infinity become null. */
export function plainJson<T>(value: T): T {
  const text = JSON.stringify(value ?? null)
  return (text === undefined ? null : JSON.parse(text)) as T
}

/**
 * Loose tool-options shape. Deriving the schema generics here makes TypeScript
 * compare inferred object types recursively until it overflows, and the call
 * sites already declare their own argument schemas.
 */
interface LooseToolOptions {
  readonly name: string
  readonly description: string
  readonly execute: (args: any, exec: any) => Promise<any>
  readonly [key: string]: unknown
}

/** {@link defineTool} whose result body is safe at DSH's lossless-JSON boundary. */
export function defineJsonTool(options: LooseToolOptions) {
  const execute = options.execute
  return defineTool({
    ...options,
    execute: async (args: any, exec: any) => plainJson(await execute(args, exec)),
  } as any)
}
