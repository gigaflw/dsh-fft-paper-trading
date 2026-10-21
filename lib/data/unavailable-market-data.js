const NOT_READY = '行情服务未就绪';
/**
 * Stand-in used until `ftshareData` is available.
 *
 * The host entry must not gate the ledger, the RPC route or the tools on the
 * market-data service: an account with history stays readable while quotes and
 * ticks fail with the same four-state shape as the real adapter. Swapping in
 * {@link FtshareMarketData} is a single assignment in the entry.
 */
export class UnavailableMarketData {
    async quotes() {
        return { state: 'failed', quotes: [], notice: NOT_READY };
    }
    async dailyBars() {
        return { state: 'failed', bars: [], notice: NOT_READY };
    }
}
//# sourceMappingURL=unavailable-market-data.js.map