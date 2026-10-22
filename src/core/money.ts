/** Money helpers. Amounts are integer cents; prices are yuan rounded to 0.01. */

export function roundPrice(price: number): number {
  if (!Number.isFinite(price)) return 0
  return Math.round(price * 100) / 100
}

export function amountCents(price: number, qty: number): number {
  return Math.round(roundPrice(price) * qty * 100)
}
