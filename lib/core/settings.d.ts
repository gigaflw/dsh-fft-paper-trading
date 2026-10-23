import type { PaperSettings } from '../contract.js';
/**
 * Merge persisted settings over {@link DEFAULT_SETTINGS}.
 *
 * A hand-edited ledger can carry `null`, a string or a non-finite number; replay
 * must never install a partial settings object because a missing field would
 * poison later arithmetic and lock the account on the next load.
 */
export declare function normalizeSettings(persisted: unknown): PaperSettings;
//# sourceMappingURL=settings.d.ts.map