/**
 * Cross-plane contract for the paper-trading plugin.
 *
 * Browser half and host half compile against these shapes; this module must stay
 * free of runtime dependencies so both sides can import it as types.
 * @module @ft/dsh-fft-paper-trading/contract
 */
/** Exact Fetch route used by the browser half. */
export const PAPER_ROUTE = '/api/ft-paper-trading';
/** Request body cap; the route rejects anything larger before parsing. */
export const PAPER_MAX_BODY_BYTES = 256 * 1024;
/**
 * Ledger schema version. v2 added day.opened; v3 pins the M2 fill model
 * (slippage 0, unlimited fill at the last price) for every older ledger.
 */
export const PAPER_LEDGER_VERSION = 3;
export const DEFAULT_SETTINGS = {
    initialCashCents: 10_000_000,
    commissionRate: 0.00025,
    minCommissionCents: 500,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageBps: 0,
    enableT1: true,
    quoteTtlSec: 30,
    maxOrderNotionalCents: 0,
    maxParticipationRate: 0.10,
    fillModel: 'unlimited',
};
export const DEFAULT_ACCOUNT_ID = 'default';
//# sourceMappingURL=contract.js.map