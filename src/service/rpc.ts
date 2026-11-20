import type { AccountMeta, BasketOrderInput, DataSourceStatus, NoteView, OrderDraft, RpcResult, Side } from '../contract.js'
import type { PaperService } from './paper-service.js'
import { PaperError } from './errors.js'
import { argumentGuards, fail, failure, ok } from './rpc-support.js'

export type PaperRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  /** Target account id or name; omitted means the kind's default account. */
  account?: string,
) => Promise<RpcResult<unknown>>

/** One resolved account: the service plus the registry entry that guards it. */
export interface PaperRpcTarget {
  service: PaperService
  meta?: AccountMeta
}

/** Resolve an account reference to its service. Omitted reference = default. */
export type PaperRpcResolver = (account?: string) => Promise<PaperRpcTarget>

/**
 * Endpoints that change account state. A locked account may still be read,
 * cancelled out of, and exported — that is how a frozen account stays
 * inspectable while it cannot trade.
 */
const MUTATING_ENDPOINTS: ReadonlySet<string> = new Set([
  'account/reset',
  'account/deposit',
  'account/withdraw',
  'ledger/restore',
  'order/place',
  'basket/place',
])

/** Refuse a state change on a locked account before the service sees it. */
function guardAccount(meta: AccountMeta | undefined, endpoint: string): void {
  if (meta === undefined || !MUTATING_ENDPOINTS.has(endpoint)) return
  if (meta.locked === true) throw new PaperError('ACCOUNT_LOCKED', `账户「${meta.name}」已锁定，不能交易`, 409)
}

const guard = argumentGuards(message => new PaperError('INVALID_ARGUMENT', message))
const record = guard.record
const text = guard.text
const num = guard.num

function draft(value: unknown): OrderDraft {
  const input = record(value)
  const side = text(input.side, 'side')
  const type = text(input.type, 'type')
  if (side !== 'buy' && side !== 'sell') throw new PaperError('INVALID_ARGUMENT', 'side 必须是 buy 或 sell')
  if (type !== 'market' && type !== 'limit') throw new PaperError('INVALID_ARGUMENT', 'type 必须是 market 或 limit')
  return {
    symbol: text(input.symbol, 'symbol'),
    side: side as Side,
    type,
    qty: num(input.qty, 'qty'),
    limitPrice: typeof input.limitPrice === 'number' ? input.limitPrice : undefined,
    price: typeof input.price === 'number' ? input.price : undefined,
  }
}

/** 32 KiB: a 20-row CSV stays tiny, but a pasted file must not slip the body cap. */
const BASKET_CSV_MAX_BYTES = 32 * 1024
const BASKET_MAX_ROWS = 20
const BASKET_BATCH_ID_MAX = 100

function basketCsv(value: unknown): string {
  const csv = text(value, 'csv')
  if (new TextEncoder().encode(csv).length > BASKET_CSV_MAX_BYTES) {
    throw new PaperError('INVALID_ARGUMENT', 'csv 不能超过 32 KiB')
  }
  return csv
}

function basketBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new PaperError('INVALID_ARGUMENT', 'budgetCents 必须是正整数（分）')
  }
  return value
}

/** Optional reset starting cash, entered in yuan like every other panel amount. */
function initialCashCents(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const yuan = num(value, 'initialCash')
  const cents = Math.round(yuan * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new PaperError('INVALID_ARGUMENT', 'initialCash 必须是正数（元）')
  }
  return cents
}

function basketRows(value: unknown): BasketOrderInput[] {
  if (!Array.isArray(value)) throw new PaperError('INVALID_ARGUMENT', 'rows 必须是数组')
  if (value.length < 1 || value.length > BASKET_MAX_ROWS) {
    throw new PaperError('INVALID_ARGUMENT', `rows 需要 1 到 ${BASKET_MAX_ROWS} 行`)
  }
  return value.map(item => {
    const input = record(item)
    return { symbol: text(input.symbol, 'symbol'), qty: num(input.qty, 'qty') }
  })
}

function basketBatchId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new PaperError('INVALID_ARGUMENT', 'batchId 必须是字符串')
  const id = value.trim()
  if (id === '') return undefined
  if (id.length > BASKET_BATCH_ID_MAX) throw new PaperError('INVALID_ARGUMENT', `batchId 不能超过 ${BASKET_BATCH_ID_MAX} 字符`)
  return id
}

function period(value: unknown): '7d' | '30d' | 'all' {
  if (value === '7d' || value === '30d' || value === 'all') return value
  return '30d'
}

export interface PaperRpcOptions {
  /** Read-only data-source state for the panel header; absent means no service. */
  dataSource?: () => Promise<DataSourceStatus>
  /**
   * Per-account free-form notes. The handler only proxies them: no tool reaches
   * this, it is the human's own space.
   */
  notes?: {
    read: (accountId: string) => Promise<NoteView>
    write: (accountId: string, text: unknown) => Promise<NoteView>
  }
}

export function createPaperRpcHandler(source: PaperService | PaperRpcResolver, options: PaperRpcOptions = {}): PaperRpcHandler {
  // A bare service keeps every pre-multi-account caller (and test) working.
  const resolve: PaperRpcResolver = typeof source === 'function' ? source : async () => ({ service: source })
  return async (endpoint, payload, signal, account) => {
    try {
      if (signal.aborted) throw new PaperError('INVALID_ARGUMENT', '请求已取消', 499)
      const { service, meta } = await resolve(account)
      guardAccount(meta, endpoint)
      switch (endpoint) {
        case 'health':
          return ok({ ok: true, version: 1 })
        case 'market/data-source':
          return ok(await (options.dataSource?.() ?? { state: 'none' }))
        case 'account/get':
        case 'account/init':
          return ok(await service.account())
        case 'account/reset': {
          const input = record(payload ?? {})
          return ok(await service.reset(input.confirm === true, initialCashCents(input.initialCash)))
        }
        case 'account/deposit':
          return ok(await service.deposit(num(record(payload).amount, 'amount')))
        case 'account/withdraw':
          return ok(await service.withdraw(num(record(payload).amount, 'amount')))
        case 'account/export':
          return ok(await service.exportLedger())
        case 'ledger/list':
          return ok(await service.ledgerSnapshots())
        case 'ledger/restore': {
          const input = record(payload)
          return ok(await service.restoreLedger(text(input.name, 'name'), input.confirm === true))
        }
        case 'ledger/backup':
          return ok({ backedUp: await service.backupLedger() })
        case 'note/get': {
          if (options.notes === undefined || meta === undefined) throw new PaperError('INTERNAL', '笔记存储不可用', 500)
          return ok(await options.notes.read(meta.id))
        }
        case 'note/set': {
          if (options.notes === undefined || meta === undefined) throw new PaperError('INTERNAL', '笔记存储不可用', 500)
          const input = record(payload ?? {})
          return ok(await options.notes.write(meta.id, input.text))
        }
        case 'settings/get':
          return ok(await service.settingsView())
        case 'market/quote': {
          const input = record(payload)
          const symbols = Array.isArray(input.symbols) ? input.symbols.filter((item): item is string => typeof item === 'string') : []
          if (symbols.length === 0) throw new PaperError('INVALID_ARGUMENT', 'symbols 不能为空')
          return ok(await service.quote(symbols))
        }
        case 'market/bars': {
          const input = record(payload)
          const symbol = text(input.symbol, 'symbol')
          const limit = typeof input.limit === 'number' ? input.limit : 60
          if (input.interval === 'minute') {
            return ok(await service.minuteBars(symbol, typeof input.date === 'string' ? input.date : undefined))
          }
          return ok(await service.dailyBars(symbol, limit))
        }
        case 'market/status':
          return ok(await service.marketStatus())
        case 'market/search': {
          const input = record(payload)
          return ok(await service.search(text(input.query, 'query'), typeof input.limit === 'number' ? input.limit : 10))
        }
        case 'market/list': {
          const input = record(payload ?? {})
          return ok(await service.marketList({
            board: typeof input.board === 'string' ? input.board : undefined,
            page: typeof input.page === 'number' ? input.page : undefined,
            pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
          }))
        }
        case 'review/daily': {
          const input = record(payload ?? {})
          return ok(await service.dailyReport(typeof input.date === 'string' ? input.date : undefined))
        }
        case 'review/roundtrips':
          return ok(await service.roundtrips())
        case 'cash/flow':
          return ok(await service.cashFlow())
        case 'shortlist/get':
          return ok({ symbols: await service.shortlist() })
        case 'shortlist/set': {
          const input = record(payload ?? {})
          const symbols = Array.isArray(input.symbols)
            ? input.symbols.filter((item): item is string => typeof item === 'string')
            : []
          return ok({ symbols: await service.setShortlist(symbols) })
        }
        case 'basket/preview': {
          const input = record(payload)
          return ok(await service.basketPreview(basketCsv(input.csv), basketBudget(input.budgetCents)))
        }
        case 'basket/place': {
          const input = record(payload)
          return ok(await service.basketPlace(basketRows(input.rows), basketBatchId(input.batchId)))
        }
        case 'order/preview':
          return ok(await service.preview(draft(payload)))
        case 'order/place': {
          const input = record(payload)
          const orderDraft = draft(input.draft ?? input)
          const requestId = typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : undefined
          return ok(await service.place(orderDraft, requestId))
        }
        case 'order/cancel': {
          const input = record(payload)
          return ok(await service.cancel(text(input.orderId, 'orderId')))
        }
        case 'tick':
          return ok(await service.tick())
        case 'list/orders':
          return ok(await service.orders())
        case 'list/trades':
          return ok(await service.trades())
        case 'review/get': {
          const input = record(payload ?? {})
          return ok(await service.review(period(input.period)))
        }
        default:
          throw new PaperError('INVALID_ARGUMENT', `未知 endpoint: ${endpoint}`, 404)
      }
    } catch (error) {
      return failure(error, item => item instanceof PaperError)
    }
  }
}
