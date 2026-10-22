/**
 * Per-lot futures fees (D5, D8).
 *
 * The exchange charges per lot, not ad valorem: `trading_fee` for open and
 * close-yesterday, `offset_today_fee` for close-today. The adapter already
 * converts yuan to cents; a missing parameter falls back to
 * `settings.defaultFeePerLotCents` (0 by default) and surfaces a warning
 * instead of inventing a rate.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/fees
 */
function feeMultiplier(settings) {
    const value = settings.feeMultiplier;
    return Number.isFinite(value) && value >= 0 ? value : 1;
}
function defaultFee(settings) {
    const value = settings.defaultFeePerLotCents;
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
/** Exchange per-lot fee in cents, with the default fallback and its warning. */
export function openFeePerLot(settle, settings) {
    const exchange = settle?.feePerLotCents;
    if (typeof exchange === 'number' && Number.isFinite(exchange) && exchange >= 0) {
        return { feePerLotCents: exchange, source: 'exchange' };
    }
    const fallback = defaultFee(settings);
    return {
        feePerLotCents: fallback,
        source: 'default',
        warning: `交易所手续费参数缺失，按每手 ${(fallback / 100).toFixed(2)} 元计`,
    };
}
/**
 * Fee for one fill.
 *
 * A close splits lots between the close-today bucket and yesterday's lots, so
 * a partial close of a position opened today is charged the close-today rate
 * for the today portion and the normal rate for the rest.
 */
export function computeFuturesFees(options) {
    const qty = Math.max(0, Math.round(options.qty));
    const warnings = [];
    const multiplier = feeMultiplier(options.settings);
    if (options.offset === 'open') {
        const perLot = openFeePerLot(options.settle, options.settings);
        if (perLot.warning !== undefined)
            warnings.push(perLot.warning);
        return {
            feesCents: Math.round(perLot.feePerLotCents * qty * multiplier),
            todayLots: 0,
            yesterdayLots: qty,
            source: perLot.source,
            warnings,
        };
    }
    const todayQty = Math.max(0, Math.round(options.todayQty ?? 0));
    const todayLots = Math.min(qty, todayQty);
    const yesterdayLots = qty - todayLots;
    const open = openFeePerLot(options.settle, options.settings);
    if (open.warning !== undefined)
        warnings.push(open.warning);
    const closeToday = options.settle?.closeTodayFeePerLotCents;
    const closeTodayRate = typeof closeToday === 'number' && Number.isFinite(closeToday) && closeToday >= 0
        ? closeToday
        : open.feePerLotCents;
    const feesCents = Math.round((todayLots * closeTodayRate + yesterdayLots * open.feePerLotCents) * multiplier);
    return {
        feesCents,
        todayLots,
        yesterdayLots,
        source: open.source,
        warnings,
    };
}
export function feeSnapshotFor(settle, settings) {
    const open = openFeePerLot(settle, settings);
    const closeToday = settle?.closeTodayFeePerLotCents;
    return {
        feePerLotCents: open.feePerLotCents,
        closeTodayFeePerLotCents: typeof closeToday === 'number' && Number.isFinite(closeToday) && closeToday >= 0
            ? closeToday
            : open.feePerLotCents,
        source: open.source,
    };
}
/** Fee from a stored snapshot; used by tick matching and settlement. */
export function feesFromSnapshot(snapshot, offset, qty, todayQty, settings) {
    const multiplier = feeMultiplier(settings);
    if (offset === 'open')
        return Math.round(snapshot.feePerLotCents * qty * multiplier);
    const todayLots = Math.min(Math.max(0, Math.round(qty)), Math.max(0, Math.round(todayQty)));
    const yesterdayLots = Math.max(0, Math.round(qty) - todayLots);
    return Math.round((todayLots * snapshot.closeTodayFeePerLotCents + yesterdayLots * snapshot.feePerLotCents) * multiplier);
}
//# sourceMappingURL=fees.js.map