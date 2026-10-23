import type { Bar, PriceLimit } from '../contract.js'
import { tradeDateOf } from './calendar.js'
import { roundPrice } from './money.js'
import { boardOf, tryParseSymbol } from './symbol.js'

/** Board ratio from the canonical symbol / ST marker; configurable in one place. */
export function limitRatioFor(symbol: string, name?: string): number {
  const label = String(name ?? '').toUpperCase()
  if (label.startsWith('*ST') || label.startsWith('ST') || label.startsWith('S*ST') || label.startsWith('SST')) return 0.05
  const parsed = tryParseSymbol(symbol)
  if (!parsed.ok) return 0.10
  switch (boardOf(parsed.symbol)) {
    case 'star':
    case 'chi_next':
      return 0.20
    case 'bjse':
      return 0.30
    default:
      return 0.10
  }
}

export function priceLimitFor(symbol: string, name: string | undefined, prevClose: number | undefined): PriceLimit | undefined {
  if (prevClose === undefined || !Number.isFinite(prevClose) || prevClose <= 0) return undefined
  const ratio = limitRatioFor(symbol, name)
  return {
    upper: roundPrice(prevClose * (1 + ratio)),
    lower: roundPrice(prevClose * (1 - ratio)),
    ratio,
    source: 'prev-close',
  }
}

export function isWithinLimit(price: number, limit: PriceLimit | undefined): boolean {
  if (limit === undefined) return true
  return price >= limit.lower && price <= limit.upper
}

/**
 * Previous close from a daily-bar series.
 *
 * FTShare keeps today's (possibly partial) bar in the series after the open, so
 * only bars before the current trade date qualify. A missing series leaves the
 * limit unknown, which the risk check treats as "no limit" rather than guessing.
 */
export function prevCloseFromBars(bars: readonly Bar[], today: string): number | undefined {
  let previous: number | undefined
  for (const bar of bars) {
    if (tradeDateOf(bar.time) >= today) continue
    if (Number.isFinite(bar.close) && bar.close > 0) previous = bar.close
  }
  return previous
}
