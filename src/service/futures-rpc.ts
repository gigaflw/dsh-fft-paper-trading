/**
 * `futures/*` RPC endpoints, mounted on the same `/api/ft-paper-trading` route
 * as the stock endpoints. The endpoint list and payloads follow
 * `docs/specs/futures-mvp.md` §2 exactly.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/service/futures-rpc
 */

import type { RpcResult } from '../contract.js'
import type { FuturesDraft, FuturesExchange } from '../futures-contract.js'
import type { FuturesService } from './futures-service.js'
import { FuturesError } from './futures-service.js'

export type FuturesRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

const EXCHANGES: readonly FuturesExchange[] = ['SHFE', 'INE', 'DCE', 'CZCE', 'GFEX']

function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new FuturesError('INVALID_ARGUMENT', '请求参数必须是对象')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new FuturesError('INVALID_ARGUMENT', `缺少 ${field}`)
  return value.trim()
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new FuturesError('INVALID_ARGUMENT', `${field} 必须是数字`)
  return value
}

function draftOf(value: unknown): FuturesDraft {
  const input = record(value)
  const side = text(input.side, 'side')
  const offset = text(input.offset, 'offset')
  const type = text(input.type, 'type')
  if (side !== 'long' && side !== 'short') throw new FuturesError('INVALID_ARGUMENT', 'side 必须是 long 或 short')
  if (offset !== 'open' && offset !== 'close') throw new FuturesError('INVALID_ARGUMENT', 'offset 必须是 open 或 close')
  if (type !== 'market' && type !== 'limit') throw new FuturesError('INVALID_ARGUMENT', 'type 必须是 market 或 limit')
  return {
    symbol: text(input.symbol, 'symbol'),
    side,
    offset,
    type,
    qty: num(input.qty, 'qty'),
    limitPrice: typeof input.limitPrice === 'number' ? input.limitPrice : undefined,
    price: typeof input.price === 'number' ? input.price : undefined,
    note: typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim().slice(0, 120) : undefined,
  }
}

function periodOf(value: unknown): '7d' | '30d' | 'all' {
  return value === '7d' || value === 'all' ? value : '30d'
}

function symbolsOf(value: unknown): string[] {
  if (!Array.isArray(value)) throw new FuturesError('INVALID_ARGUMENT', '缺少 symbols')
  const symbols = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
  if (symbols.length === 0) throw new FuturesError('INVALID_ARGUMENT', 'symbols 不能为空')
  return symbols
}

export function createFuturesRpcHandler(service: FuturesService): FuturesRpcHandler {
  return async (endpoint, payload, signal) => {
    try {
      if (signal.aborted) throw new FuturesError('INVALID_ARGUMENT', '请求已取消')
      switch (endpoint) {
        case 'futures/account/get':
          return ok(await service.account())
        case 'futures/account/reset': {
          const input = record(payload)
          return ok(await service.reset(input.confirm === true))
        }
        case 'futures/account/export':
          return ok(await service.exportLedger())
        case 'futures/ledger/list':
          return ok(await service.ledgerSnapshots())
        case 'futures/ledger/restore': {
          const input = record(payload)
          return ok(await service.restoreLedger(text(input.name, 'name'), input.confirm === true))
        }
        case 'futures/ledger/backup':
          return ok({ backedUp: await service.backupLedger() })
        case 'futures/account/deposit':
          return ok(await service.deposit(num(record(payload).amount, 'amount')))
        case 'futures/account/withdraw':
          return ok(await service.withdraw(num(record(payload).amount, 'amount')))
        case 'futures/cash/flow':
          return ok(await service.cashFlow())
        case 'futures/contracts': {
          const input = record(payload)
          const exchange = typeof input.exchange === 'string' ? input.exchange : undefined
          if (exchange !== undefined && !EXCHANGES.includes(exchange as FuturesExchange)) {
            throw new FuturesError('INVALID_ARGUMENT', 'exchange 必须是 SHFE/INE/DCE/CZCE/GFEX')
          }
          return ok(await service.contracts({
            query: typeof input.query === 'string' ? input.query : undefined,
            exchange: exchange as FuturesExchange | undefined,
            limit: typeof input.limit === 'number' ? input.limit : undefined,
            refresh: input.refresh === true,
          }))
        }
        case 'futures/quote':
          return ok(await service.quote(symbolsOf(record(payload).symbols)))
        case 'futures/status':
          return ok(await service.status())
        case 'futures/preview':
          return ok(await service.preview(draftOf(payload)))
        case 'futures/order': {
          const input = record(payload)
          const requestId = typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : undefined
          return ok(await service.place(draftOf(input.draft ?? input), requestId))
        }
        case 'futures/cancel':
          return ok(await service.cancel(text(record(payload).orderId, 'orderId')))
        case 'futures/positions':
          return ok(await service.positions())
        case 'futures/orders':
          return ok(await service.orders())
        case 'futures/trades':
          return ok(await service.trades())
        case 'futures/review':
          return ok(await service.review(periodOf(record(payload).period)))
        case 'futures/tick':
          return ok(await service.tick())
        default:
          throw new FuturesError('INVALID_ARGUMENT', `未知 endpoint: ${endpoint}`, 404)
      }
    } catch (error) {
      if (error instanceof FuturesError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}
