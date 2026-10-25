/**
 * Futures margin, realized PnL and risk (D3, D6, D7).
 *
 * Margin per lot = price × multiplier × rate, charged separately on each
 * side. The rate source priority is the daily limit ratio, then the settlement
 * long margin rate, then the static contract margin from the index.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/core/futures/margin
 */
/**
 * Normalise an exchange ratio to a decimal.
 *
 * The adapter converts `m_ratio: 10` into `0.1`, but a hand-written ledger or
 * an alternative port may still hand over the raw percentage; accepting both
 * is safer than turning 10 into a 1000% margin.
 */
function normalizeRate(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return undefined;
    const rate = value > 1 && value <= 100 ? value / 100 : value;
    return rate > 0 && rate <= 2 ? rate : undefined;
}
export function marginRateFor(input) {
    const uplift = Number.isFinite(input.settings.marginUplift) && input.settings.marginUplift > 0
        ? input.settings.marginUplift
        : 0;
    const candidates = [
        { value: input.limit?.marginRate, source: 'limit' },
        { value: input.settle?.longMarginRate, source: 'settle' },
        { value: input.contract?.marginRate, source: 'contract' },
    ];
    for (const candidate of candidates) {
        const rate = normalizeRate(candidate.value);
        if (rate === undefined)
            continue;
        const withUplift = Number((rate + uplift).toFixed(6));
        return withUplift <= 2 ? { rate: withUplift, source: candidate.source } : { rate, source: candidate.source };
    }
    return {};
}
/** Initial margin in cents for a fill at `price`. */
export function marginCentsFor(price, multiplier, qty, rate) {
    if (!Number.isFinite(price) || !Number.isFinite(multiplier) || !Number.isFinite(qty) || !Number.isFinite(rate))
        return 0;
    if (price <= 0 || multiplier <= 0 || qty <= 0 || rate <= 0)
        return 0;
    return Math.round(price * multiplier * qty * rate * 100);
}
export function unrealizedPnlCents(position) {
    const mark = position.lastPrice;
    if (mark === undefined || !Number.isFinite(mark) || mark <= 0)
        return 0;
    const diff = position.side === 'long' ? mark - position.avgPrice : position.avgPrice - mark;
    return Math.round(diff * position.multiplier * position.qty * 100);
}
/** Realized PnL in cents when closing `qty` lots at `price`. */
export function realizedPnlCents(side, avgPrice, price, multiplier, qty) {
    const diff = side === 'long' ? price - avgPrice : avgPrice - price;
    return Math.round(diff * multiplier * qty * 100);
}
/** Equity = free cash + occupied margin + float at the latest marks. */
export function markToMarket(state) {
    let marginCents = 0;
    let unrealizedCents = 0;
    for (const position of Object.values(state.positions)) {
        marginCents += position.marginCents;
        unrealizedCents += unrealizedPnlCents(position);
    }
    return {
        marginCents,
        unrealizedCents,
        equityCents: state.cashCents + marginCents + unrealizedCents,
    };
}
/**
 * Risk ratio used for warnings and liquidation.
 *
 * Returns `Infinity` when equity is not positive: an account that has lost its
 * equity is always liquidated. Views report the contract's `0` instead, which
 * is why {@link riskRatioView} exists separately.
 */
export function riskRatioFor(marginCents, equityCents) {
    if (!(equityCents > 0))
        return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(marginCents) || marginCents <= 0)
        return 0;
    return marginCents / equityCents;
}
/** Contract-facing risk ratio: `margin / equity`, or 0 when equity ≤ 0. */
export function riskRatioView(marginCents, equityCents) {
    if (!(equityCents > 0))
        return 0;
    if (!Number.isFinite(marginCents) || marginCents <= 0)
        return 0;
    return marginCents / equityCents;
}
/** Largest open quantity affordable with `cashCents` reserved as margin + fees. */
export function maxOpenQty(input) {
    const { cashCents, price, multiplier, marginRate } = input;
    if (!Number.isFinite(cashCents) || cashCents <= 0)
        return 0;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(multiplier) || multiplier <= 0)
        return 0;
    if (!Number.isFinite(marginRate) || marginRate <= 0)
        return 0;
    const multiplierFee = Number.isFinite(input.settings.feeMultiplier) && input.settings.feeMultiplier >= 0
        ? input.settings.feeMultiplier
        : 1;
    const feePerLot = Math.max(0, input.feePerLotCents) * multiplierFee;
    const marginPerLot = price * multiplier * marginRate * 100;
    const perLot = marginPerLot + feePerLot;
    if (!Number.isFinite(perLot) || perLot <= 0)
        return 0;
    let qty = Math.floor(cashCents / perLot);
    // Rounding of the total can make the last lot unaffordable; walk down to the
    // exact checked quantity instead of over-reporting the button.
    while (qty > 0) {
        const margin = Math.round(marginPerLot * qty);
        const fees = Math.round(feePerLot * qty);
        if (margin + fees <= cashCents)
            break;
        qty -= 1;
    }
    return Math.max(0, qty);
}
//# sourceMappingURL=margin.js.map