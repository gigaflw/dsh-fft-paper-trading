/**
 * Ledger schema migrations.
 *
 * A ledger version is only bumped when replay semantics change. When that
 * happens the previous version must still be recoverable: a locked account is
 * allowed to lose nothing, so the loader rewrites an old ledger into the
 * current shape instead of telling the user to reset.
 *
 * The chain is deliberately adjacent-only (`v3 → v4`). Older ledgers whose
 * semantics cannot be reconstructed are refused, not guessed; their owners are
 * told to run the matching plugin version or restore a snapshot.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/migrations
 */

import { PAPER_LEDGER_VERSION } from '../contract.js'
import { tryParseSymbol } from './symbol.js'
import type { LedgerEvent } from './types.js'

/** Raised when a ledger exists but cannot be brought to the current version. */
export class MigrationUnavailable extends Error {
  constructor(
    readonly from: number,
    message: string,
  ) {
    super(message)
    this.name = 'MigrationUnavailable'
  }
}

export interface MigrationOutcome {
  events: LedgerEvent[]
  from: number
  to: number
}

/** Version recorded by the genesis event; an empty ledger counts as current. */
export function ledgerVersionOf(events: readonly LedgerEvent[]): number {
  for (const event of events) {
    if (event.type === 'account.opened') return event.payload.ledgerVersion ?? 1
    if (event.type === 'account.reset') return PAPER_LEDGER_VERSION
  }
  return PAPER_LEDGER_VERSION
}

type Migration = (events: LedgerEvent[]) => LedgerEvent[]

/** One entry per `from` version; each step lands exactly one version higher. */
const MIGRATIONS: Record<number, Migration> = {
  3: migrateV3ToV4,
}

/**
 * Bring `events` up to {@link PAPER_LEDGER_VERSION}.
 *
 * Returns `undefined` when the ledger is already current. Throws
 * {@link MigrationUnavailable} when the version is newer than this build or no
 * migration exists; callers must keep the original file and lock instead.
 */
export function migrateLedger(events: LedgerEvent[]): MigrationOutcome | undefined {
  const from = ledgerVersionOf(events)
  if (from === PAPER_LEDGER_VERSION) return undefined
  if (from > PAPER_LEDGER_VERSION) {
    throw new MigrationUnavailable(from, `账本版本 ${from} 高于当前插件支持的 ${PAPER_LEDGER_VERSION}，请升级插件`)
  }
  let version = from
  let current = events
  while (version < PAPER_LEDGER_VERSION) {
    const migration = MIGRATIONS[version]
    if (migration === undefined) {
      throw new MigrationUnavailable(version, `账本版本 ${version} 到 ${version + 1} 没有迁移路径，请改用 ${version === 3 ? 'v0.3.x' : `${version}.x`} 插件或恢复快照`)
    }
    current = migration(current)
    version += 1
  }
  return { events: current, from, to: version }
}

/** Canonicalise one stored symbol; a value the parser rejects makes the ledger unmigratable. */
function canonical(id: string, where: string): string {
  const parsed = tryParseSymbol(id)
  if (!parsed.ok) throw new MigrationUnavailable(3, `无法迁移${where} ${id}：${parsed.message}`)
  return parsed.symbol.id
}

function keyedSymbols(record: Record<string, number>, where: string): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [key, value] of Object.entries(record)) {
    next[canonical(key, where)] = value
  }
  return next
}

/**
 * v3 stored whatever the user typed (`000001` or `000001.SZ` were two books);
 * v4 stores `<code>.<exchange>` everywhere.
 *
 * Bare codes only ever resolved through the stock namespace, so canonicalising
 * every occurrence is faithful. Merging the two keys is the intended repair: the
 * split book was the bug, and replay recomputes cost basis from the fills.
 */
function migrateV3ToV4(events: LedgerEvent[]): LedgerEvent[] {
  return events.map(event => {
    switch (event.type) {
      case 'account.opened':
        return { ...event, payload: { ...event.payload, ledgerVersion: PAPER_LEDGER_VERSION } }
      case 'order.submitted': {
        const order = { ...event.payload.order, symbol: canonical(event.payload.order.symbol, '订单标的') }
        // The quote snapshot is display history, but keeping the same identity
        // rule everywhere avoids a second symbol dialect in the ledger.
        const quote = { ...event.payload.quote, symbol: order.symbol }
        return { ...event, payload: { ...event.payload, order, quote } }
      }
      case 'order.rejected': {
        const order = { ...event.payload.order, symbol: canonical(event.payload.order.symbol, '订单标的') }
        return { ...event, payload: { order, reason: event.payload.reason } }
      }
      case 'order.filled': {
        const fill = { ...event.payload.fill, symbol: canonical(event.payload.fill.symbol, '成交标的') }
        return { ...event, payload: { orderId: event.payload.orderId, fill } }
      }
      case 'order.partially_filled': {
        const fill = { ...event.payload.fill, symbol: canonical(event.payload.fill.symbol, '成交标的') }
        return { ...event, payload: { orderId: event.payload.orderId, fill } }
      }
      case 'day.opened':
        return {
          ...event,
          payload: {
            ...event.payload,
            openPrices: keyedSymbols(event.payload.openPrices, '开盘价'),
            prevClose: keyedSymbols(event.payload.prevClose, '昨收价'),
            gaps: keyedSymbols(event.payload.gaps, '跳空'),
          },
        }
      case 'day.closed': {
        const payload = { ...event.payload }
        if (payload.closePrices !== undefined) payload.closePrices = keyedSymbols(payload.closePrices, '收盘价')
        if (payload.gaps !== undefined) payload.gaps = keyedSymbols(payload.gaps, '跳空')
        if (payload.positions !== undefined) {
          payload.positions = payload.positions.map(position => ({
            ...position,
            symbol: canonical(position.symbol, '持仓标的'),
          }))
        }
        return { ...event, payload }
      }
      default:
        return event
    }
  })
}
