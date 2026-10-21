import type { PaperSettings, Quote } from '../contract.js'
import { roundPrice, slipped } from './money.js'
import type { Order } from './types.js'

export interface FillDecision {
  fill: boolean
  price?: number
  reason?: 'QUOTE_STALE' | 'NOT_CROSSED'
}

export function quoteFresh(quote: Quote, settings: PaperSettings, nowMs: number): boolean {
  const marketTs = quote.marketTs ?? quote.ts
  if (marketTs === undefined || marketTs === null) return false
  const ts = Date.parse(marketTs)
  if (Number.isNaN(ts)) return false
  return nowMs - ts <= settings.quoteTtlSec * 1000
}

/**
 * Fill rule for the MVP: whole-quantity fills only.
 * Market orders pay the ask / receive the bid after slippage; limit orders
 * cross only when the opposite quote reaches the limit, and are capped by it.
 */
export function decideFill(order: Order, quote: Quote, settings: PaperSettings, nowMs: number): FillDecision {
  if (!quoteFresh(quote, settings, nowMs)) return { fill: false, reason: 'QUOTE_STALE' }
  if (order.type === 'market') {
    // FTShare has no bid/ask; last is the only executable reference.
    const base = quote.last
    if (!Number.isFinite(base) || base <= 0) return { fill: false, reason: 'QUOTE_STALE' }
    return { fill: true, price: slipped(base, order.side, settings.slippageBps) }
  }
  const limit = order.limitPrice
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return { fill: false, reason: 'NOT_CROSSED' }
  if (order.side === 'buy') {
    if (quote.last > limit) return { fill: false, reason: 'NOT_CROSSED' }
    const price = Math.min(limit, slipped(quote.last, 'buy', settings.slippageBps))
    return { fill: true, price: roundPrice(price) }
  }
  if (quote.last < limit) return { fill: false, reason: 'NOT_CROSSED' }
  const price = Math.max(limit, slipped(quote.last, 'sell', settings.slippageBps))
  return { fill: true, price: roundPrice(price) }
}
