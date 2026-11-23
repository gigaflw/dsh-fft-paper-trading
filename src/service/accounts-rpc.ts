/**
 * `accounts/*` RPC endpoints.
 *
 * Account administration is deliberately kept out of {@link createPaperRpcHandler}:
 * that handler owns trading and never touches the registry file, while these
 * endpoints only edit metadata (create / rename / archive / lock). Both are mounted
 * on the same route, so the browser half still has one door.
 *
 * There is no session endpoint on purpose: this plugin knows nothing about
 * sessions, and every caller addresses an account by id or display name.
 * @module @dsh-ft/dsh-fft-paper-trading/service/accounts-rpc
 */

import type { AccountKind } from '../contract.js'
import type { AccountRegistry } from '../store/accounts.js'
import { PaperError } from './errors.js'
import type { PaperRpcHandler } from './rpc.js'
import { argumentGuards, fail, failure, ok } from './rpc-support.js'

const guard = argumentGuards(message => new PaperError('INVALID_ARGUMENT', message))
const record = guard.record
const text = guard.text

function kindOf(value: unknown): AccountKind | undefined {
  if (value === undefined || value === null) return undefined
  if (value === 'stock' || value === 'futures') return value
  throw new PaperError('INVALID_ARGUMENT', 'kind 必须是 stock 或 futures')
}

/** Yuan input from the panel; the registry stores cents like the ledger does. */
function cashCents(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new PaperError('INVALID_ARGUMENT', 'initialCash 必须是正数（元）')
  }
  return Math.round(value * 100)
}

/** Routes `accounts/*`; every other endpoint is somebody else's. */
export function createAccountsRpcHandler(registry: AccountRegistry): PaperRpcHandler {
  return async (endpoint, payload) => {
    try {
      const input = record(payload ?? {})
      switch (endpoint) {
        case 'accounts/list': {
          const kind = kindOf(input.kind)
          return ok(await registry.view({
            includeArchived: input.includeArchived === true,
            ...(kind === undefined ? {} : { kind }),
          }))
        }
        case 'accounts/create':
          if (kindOf(input.kind) === 'futures') {
            // Futures is still one ledger with its own panel; a second futures
            // entry would be unreachable and fail every stock request.
            throw new PaperError('INVALID_ARGUMENT', 'v1 只支持新建股票账户')
          }
          return ok(await registry.create({
            name: text(input.name, 'name'),
            ...(kindOf(input.kind) === undefined ? {} : { kind: kindOf(input.kind) as AccountKind }),
            ...(cashCents(input.initialCash) === undefined ? {} : { initialCashCents: cashCents(input.initialCash) as number }),
          }))
        case 'accounts/rename':
          return ok(await registry.rename(text(input.id, 'id'), text(input.name, 'name')))
        case 'accounts/archive':
          return ok(await registry.archive(text(input.id, 'id')))
        case 'accounts/unarchive':
          return ok(await registry.unarchive(text(input.id, 'id')))
        case 'accounts/lock':
          return ok(await registry.lock(text(input.id, 'id')))
        case 'accounts/unlock':
          return ok(await registry.unlock(text(input.id, 'id')))
        default:
          return fail('INVALID_ARGUMENT', `未知端点 ${endpoint}`)
      }
    } catch (error) {
      return failure(error, item => item instanceof PaperError)
    }
  }
}
