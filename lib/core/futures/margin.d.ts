/**
 * Futures margin, realized PnL and risk (D3, D6, D7).
 *
 * Margin per lot = price × multiplier × rate, charged separately on each
 * side. The rate source priority is the daily limit ratio, then the settlement
 * long margin rate, then the static contract margin from the index.
 *
 * @module @ft/dsh-fft-paper-trading/core/futures/margin
 */
import type { FuturesSettings, FuturesSide } from '../../futures-contract.js';
import type { LimitInput, SettleInput, ContractTerms } from './types.js';
export interface MarginRateResult {
    rate?: number;
    source?: 'limit' | 'settle' | 'contract';
}
export declare function marginRateFor(input: {
    limit?: LimitInput;
    settle?: SettleInput;
    contract?: ContractTerms;
    settings: FuturesSettings;
}): MarginRateResult;
/** Initial margin in cents for a fill at `price`. */
export declare function marginCentsFor(price: number, multiplier: number, qty: number, rate: number): number;
export declare function unrealizedPnlCents(position: {
    side: FuturesSide;
    qty: number;
    avgPrice: number;
    multiplier: number;
    lastPrice?: number;
}): number;
/** Realized PnL in cents when closing `qty` lots at `price`. */
export declare function realizedPnlCents(side: FuturesSide, avgPrice: number, price: number, multiplier: number, qty: number): number;
export interface MarkToMarket {
    marginCents: number;
    unrealizedCents: number;
    equityCents: number;
}
/** Equity = free cash + occupied margin + float at the latest marks. */
export declare function markToMarket(state: {
    cashCents: number;
    positions: Record<string, {
        marginCents: number;
        side: FuturesSide;
        qty: number;
        avgPrice: number;
        multiplier: number;
        lastPrice?: number;
    }>;
}): MarkToMarket;
/**
 * Risk ratio used for warnings and liquidation.
 *
 * Returns `Infinity` when equity is not positive: an account that has lost its
 * equity is always liquidated. Views report the contract's `0` instead, which
 * is why {@link riskRatioView} exists separately.
 */
export declare function riskRatioFor(marginCents: number, equityCents: number): number;
/** Contract-facing risk ratio: `margin / equity`, or 0 when equity ≤ 0. */
export declare function riskRatioView(marginCents: number, equityCents: number): number;
/** Largest open quantity affordable with `cashCents` reserved as margin + fees. */
export declare function maxOpenQty(input: {
    cashCents: number;
    price: number;
    multiplier: number;
    marginRate: number;
    feePerLotCents: number;
    settings: FuturesSettings;
}): number;
//# sourceMappingURL=margin.d.ts.map