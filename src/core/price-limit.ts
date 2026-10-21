import type { PriceLimit } from '../contract.js'
import { roundPrice } from './money.js'

/** Board ratio from the symbol prefix / ST marker; configurable in one place. */
export function limitRatioFor(symbol: string, name?: string): number {
  const bare = symbol.trim().toUpperCase().split('.')[0]
  const label = String(name ?? '').toUpperCase()
  if (label.startsWith('*ST') || label.startsWith('ST') || label.startsWith('S*ST') || label.startsWith('SST')) return 0.05
  if (/^(300|301|688|689)/.test(bare)) return 0.20
  if (/^(4|8|920)/.test(bare)) return 0.30
  return 0.10
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
