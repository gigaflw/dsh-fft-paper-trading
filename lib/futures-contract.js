/**
 * Cross-plane contract for the futures account (MVP).
 *
 * Browser half and host half compile against these shapes. The module is
 * intentionally free of runtime dependencies (only a settings constant) and
 * does not import the stock contract, so the two ledgers can evolve apart.
 *
 * Symbols use the market-data (CTP) suffix set: `.SHFE .INE .DCE .CZCE .GFEX`.
 * @module @dsh-ft/dsh-fft-paper-trading/futures-contract
 */
/** Ledger schema version, independent from the stock ledger. */
export const FUTURES_LEDGER_VERSION = 1;
/** Fixed account id; the futures account is single and separate. */
export const FUTURES_ACCOUNT_ID = 'futures';
export const DEFAULT_FUTURES_SETTINGS = {
    initialCashCents: 100_000_000,
    marginUplift: 0,
    feeMultiplier: 1,
    warnRiskRatio: 0.8,
    liquidateRiskRatio: 1,
    closeBeforeDeListDays: 3,
    defaultFeePerLotCents: 0,
};
//# sourceMappingURL=futures-contract.js.map