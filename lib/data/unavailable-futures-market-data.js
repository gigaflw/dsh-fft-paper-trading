/**
 * Degraded port: the panel and the ledger must stay usable without FTShare, so
 * every call reports `failed` with one readable reason instead of throwing.
 */
export class UnavailableFuturesMarketData {
    notice = '期货行情不可用：未连接 FTShare 或当前套餐无权限';
    fail() {
        return Promise.resolve({ state: 'failed', notice: this.notice });
    }
    contracts() {
        return this.fail();
    }
    quotes() {
        return this.fail();
    }
    limits() {
        return this.fail();
    }
    settle() {
        return this.fail();
    }
    closes() {
        return this.fail();
    }
}
//# sourceMappingURL=unavailable-futures-market-data.js.map