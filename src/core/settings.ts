import type { FillModel, PaperSettings } from '../contract.js'
import { DEFAULT_SETTINGS } from '../contract.js'

const FILL_MODELS: readonly FillModel[] = ['volume-share', 'unlimited']

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown, fallback: number): number {
  const parsed = finite(value, Number.NaN)
  return parsed >= 0 ? parsed : fallback
}

function positive(value: unknown, fallback: number): number {
  const parsed = finite(value, Number.NaN)
  return parsed > 0 ? parsed : fallback
}

function rate(value: unknown): number {
  const parsed = finite(value, Number.NaN)
  return parsed > 0 && parsed <= 1 ? parsed : DEFAULT_SETTINGS.maxParticipationRate
}

/**
 * Merge persisted settings over {@link DEFAULT_SETTINGS}.
 *
 * Ledgers written before v0.2 have no `maxParticipationRate` / `fillModel`, and a
 * hand-edited file can carry `null` or a non-finite number. Replay must never
 * install a partial settings object: `fillQty` would multiply by `undefined`,
 * write a NaN fill, and the next load would lock the account. Every
 * `account.opened` / `account.reset` payload therefore goes through this merge,
 * which also makes the migration independent of `PAPER_LEDGER_VERSION`.
 */
export function normalizeSettings(persisted: unknown): PaperSettings {
  const input = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Record<string, unknown>
  const fillModel = FILL_MODELS.includes(input.fillModel as FillModel)
    ? (input.fillModel as FillModel)
    : DEFAULT_SETTINGS.fillModel
  return {
    initialCashCents: Math.round(nonNegative(input.initialCashCents, DEFAULT_SETTINGS.initialCashCents)),
    commissionRate: nonNegative(input.commissionRate, DEFAULT_SETTINGS.commissionRate),
    minCommissionCents: Math.round(nonNegative(input.minCommissionCents, DEFAULT_SETTINGS.minCommissionCents)),
    stampDutyRate: nonNegative(input.stampDutyRate, DEFAULT_SETTINGS.stampDutyRate),
    transferFeeRate: nonNegative(input.transferFeeRate, DEFAULT_SETTINGS.transferFeeRate),
    slippageBps: nonNegative(input.slippageBps, DEFAULT_SETTINGS.slippageBps),
    enableT1: typeof input.enableT1 === 'boolean' ? input.enableT1 : DEFAULT_SETTINGS.enableT1,
    quoteTtlSec: positive(input.quoteTtlSec, DEFAULT_SETTINGS.quoteTtlSec),
    maxOrderNotionalCents: Math.round(nonNegative(input.maxOrderNotionalCents, DEFAULT_SETTINGS.maxOrderNotionalCents)),
    maxParticipationRate: rate(input.maxParticipationRate),
    fillModel,
  }
}
