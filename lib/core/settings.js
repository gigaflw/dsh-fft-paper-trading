import { DEFAULT_SETTINGS } from '../contract.js';
const FILL_MODELS = ['volume-share', 'unlimited'];
function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function nonNegative(value, fallback) {
    const parsed = finite(value, Number.NaN);
    return parsed >= 0 ? parsed : fallback;
}
function positive(value, fallback) {
    const parsed = finite(value, Number.NaN);
    return parsed > 0 ? parsed : fallback;
}
function rate(value) {
    const parsed = finite(value, Number.NaN);
    return parsed > 0 && parsed <= 1 ? parsed : DEFAULT_SETTINGS.maxParticipationRate;
}
/**
 * Merge persisted settings over {@link DEFAULT_SETTINGS}.
 *
 * Ledgers written before v0.2 have no `maxParticipationRate` / `fillModel`, and a
 * hand-edited file can carry `null` or a non-finite number. Replay must never
 * install a partial settings object: a missing field would poison later
 * arithmetic and lock the account on the next load. Every `account.opened` /
 * `account.reset` payload therefore goes through this merge.
 */
export function normalizeSettings(persisted) {
    const input = (typeof persisted === 'object' && persisted !== null ? persisted : {});
    const fillModel = FILL_MODELS.includes(input.fillModel)
        ? input.fillModel
        : DEFAULT_SETTINGS.fillModel;
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
    };
}
/**
 * Normalised settings with the M2 fill model pinned.
 *
 * Older ledgers could persist slippage or `volume-share`, and there was never a
 * settings UI to opt in. M2 fills at `last` in one chunk, so replay rewrites
 * those knobs instead of advertising a model the engine no longer has.
 */
export function m2Settings(persisted) {
    return { ...normalizeSettings(persisted), slippageBps: 0, fillModel: 'unlimited' };
}
//# sourceMappingURL=settings.js.map