/** Money helpers. Amounts are integer cents; prices are yuan rounded to 0.01. */

export function roundPrice(price: number): number {
  if (!Number.isFinite(price)) return 0
  return Math.round(price * 100) / 100
}

export function amountCents(price: number, qty: number): number {
  return Math.round(roundPrice(price) * qty * 100)
}

/** Apply slippage to one side of a quote. */
export function slipped(price: number, side: 'buy' | 'sell', bps: number): number {
  // Integer-cent math keeps the result deterministic across float rounding.
  const cents = Math.round(price * 100)
  const numerator = side === 'buy' ? 10_000 + bps : 10_000 - bps
  return Math.round((cents * numerator) / 10_000) / 100
}
