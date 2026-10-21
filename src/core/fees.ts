import type { PaperSettings } from '../contract.js'
import type { FeeBreakdown } from './types.js'

/**
 * A-share fee model used by both preview and fill.
 *
 * Commission has a minimum; stamp duty is sell-only; transfer fee is charged
 * on both sides. Every amount is rounded to one cent independently.
 */
export function computeFees(amountCents: number, side: 'buy' | 'sell', settings: PaperSettings): FeeBreakdown {
  const gross = Math.max(0, Math.round(amountCents))
  const commissionCents = Math.max(
    Math.round(gross * settings.commissionRate),
    settings.minCommissionCents,
  )
  const stampCents = side === 'sell' ? Math.round(gross * settings.stampDutyRate) : 0
  const transferCents = Math.round(gross * settings.transferFeeRate)
  return {
    commissionCents,
    stampCents,
    transferCents,
    totalCents: commissionCents + stampCents + transferCents,
  }
}
