/**
 * Per-lot futures fees (D5, D8).
 *
 * The exchange charges per lot, not ad valorem: `trading_fee` for open and
 * close-yesterday, `offset_today_fee` for close-today. The adapter already
 * converts yuan to cents; a missing parameter falls back to
 * `settings.defaultFeePerLotCents` (0 by default) and surfaces a warning
 * instead of inventing a rate.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/futures/fees
 */
import type { FuturesOffset, FuturesSettings } from '../../futures-contract.js';
import type { FeeSource, SettleInput } from './types.js';
export interface FeeOptions {
    offset: FuturesOffset;
    qty: number;
    /** Lots of the position opened on the current trade date (close only). */
    todayQty?: number;
    settle?: SettleInput;
    settings: FuturesSettings;
}
export interface FeeBreakdown {
    feesCents: number;
    todayLots: number;
    yesterdayLots: number;
    source: FeeSource;
    warnings: string[];
}
/** Exchange per-lot fee in cents, with the default fallback and its warning. */
export declare function openFeePerLot(settle: SettleInput | undefined, settings: FuturesSettings): {
    feePerLotCents: number;
    source: FeeSource;
    warning?: string;
};
/**
 * Fee for one fill.
 *
 * A close splits lots between the close-today bucket and yesterday's lots, so
 * a partial close of a position opened today is charged the close-today rate
 * for the today portion and the normal rate for the rest.
 */
export declare function computeFuturesFees(options: FeeOptions): FeeBreakdown;
/** Fee snapshot stored on a position/order so later data loss cannot change it. */
export interface FeeSnapshot {
    feePerLotCents: number;
    closeTodayFeePerLotCents: number;
    source: FeeSource;
}
export declare function feeSnapshotFor(settle: SettleInput | undefined, settings: FuturesSettings): FeeSnapshot;
/** Fee from a stored snapshot; used by tick matching and settlement. */
export declare function feesFromSnapshot(snapshot: FeeSnapshot, offset: FuturesOffset, qty: number, todayQty: number, settings: FuturesSettings): number;
//# sourceMappingURL=fees.d.ts.map