import type { PaperSettings } from '../contract.js';
/**
 * Merge persisted settings over {@link DEFAULT_SETTINGS}.
 *
 * Ledgers written before v0.2 have no `maxParticipationRate` / `fillModel`, and a
 * hand-edited file can carry `null` or a non-finite number. Replay must never
 * install a partial settings object: a missing field would poison later
 * arithmetic and lock the account on the next load. Every `account.opened` /
 * `account.reset` payload therefore goes through this merge.
 */
export declare function normalizeSettings(persisted: unknown): PaperSettings;
/**
 * Normalised settings with the M2 fill model pinned.
 *
 * Older ledgers could persist slippage or `volume-share`, and there was never a
 * settings UI to opt in. M2 fills at `last` in one chunk, so replay rewrites
 * those knobs instead of advertising a model the engine no longer has.
 */
export declare function m2Settings(persisted: unknown): PaperSettings;
//# sourceMappingURL=settings.d.ts.map