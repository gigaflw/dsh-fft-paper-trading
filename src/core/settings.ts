import type { PaperSettings } from '../contract.js'
import { DEFAULT_SETTINGS } from '../contract.js'

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown, fallback: number): number {
  const parsed = finite(value, Number.NaN)
  return parsed >= 0 ? parsed : fallback
}

/**
 * Merge persisted settings over {@link DEFAULT_SETTINGS}.
 *
 * A hand-edited ledger can carry `null`, a string or a non-finite number; replay
 * must never install a partial settings object because a missing field would
 * poison later arithmetic and lock the account on the next load.
 */
export function normalizeSettings(persisted: unknown): PaperSettings {
  const input = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Record<string, unknown>
  return {
    initialCashCents: Math.round(nonNegative(input.initialCashCents, DEFAULT_SETTINGS.initialCashCents)),
    commissionRate: nonNegative(input.commissionRate, DEFAULT_SETTINGS.commissionRate),
    minCommissionCents: Math.round(nonNegative(input.minCommissionCents, DEFAULT_SETTINGS.minCommissionCents)),
    stampDutyRate: nonNegative(input.stampDutyRate, DEFAULT_SETTINGS.stampDutyRate),
    transferFeeRate: nonNegative(input.transferFeeRate, DEFAULT_SETTINGS.transferFeeRate),
    enableT1: typeof input.enableT1 === 'boolean' ? input.enableT1 : DEFAULT_SETTINGS.enableT1,
    maxOrderNotionalCents: Math.round(nonNegative(input.maxOrderNotionalCents, DEFAULT_SETTINGS.maxOrderNotionalCents)),
  }
}
