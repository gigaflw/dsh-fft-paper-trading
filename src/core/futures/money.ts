/**
 * Futures money helpers.
 *
 * Prices are yuan quantized to the contract tick; amounts are integer cents.
 * Every derived amount is rounded once, at the point it becomes cents, so
 * replay and preview agree exactly.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/money
 */

/** Decimal places carried by a tick size (0.005 → 3, 0.2 → 1, 2 → 0). */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 2
  const text = String(value)
  const dot = text.indexOf('.')
  if (dot < 0) return 0
  return Math.min(6, text.length - dot - 1)
}

/**
 * Quantize a price to the contract tick.
 *
 * Integer scaling avoids the classic `0.005 × 3 = 0.015` float drift that
 * would make a fill price differ from its preview.
 */
export function quantizePrice(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  if (!Number.isFinite(tickSize) || tickSize <= 0) return Math.round(price * 100) / 100
  const decimals = decimalsOf(tickSize)
  const factor = 10 ** decimals
  const tick = Math.round(tickSize * factor)
  if (tick <= 0) return Math.round(price * 100) / 100
  return (Math.round((price * factor) / tick) * tick) / factor
}

/** Notional in cents: price × multiplier × lots. */
export function amountCents(price: number, multiplier: number, qty: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(multiplier) || !Number.isFinite(qty)) return 0
  return Math.round(price * multiplier * qty * 100)
}

export function roundCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

export function centsToYuan(cents: number): number {
  return Number.isFinite(cents) ? cents / 100 : 0
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
