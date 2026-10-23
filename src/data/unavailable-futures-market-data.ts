import type {
  FuturesContractMeta,
  FuturesDataResult,
  FuturesMarketDataPort,
  FuturesRawClose,
  FuturesRawLimit,
  FuturesRawQuote,
  FuturesRawSettle,
} from './futures-market-data-port.js'

/**
 * Degraded port: the panel and the ledger must stay usable without FTShare, so
 * every call reports `failed` with one readable reason instead of throwing.
 */
export class UnavailableFuturesMarketData implements FuturesMarketDataPort {
  private readonly notice = '期货行情不可用：未连接 FTShare 或当前套餐无权限'

  private fail<T>(): Promise<FuturesDataResult<T>> {
    return Promise.resolve({ state: 'failed', notice: this.notice })
  }

  contracts(): Promise<FuturesDataResult<FuturesContractMeta[]>> {
    return this.fail()
  }

  quotes(): Promise<FuturesDataResult<FuturesRawQuote[]>> {
    return this.fail()
  }

  limits(): Promise<FuturesDataResult<FuturesRawLimit[]>> {
    return this.fail()
  }

  settle(): Promise<FuturesDataResult<FuturesRawSettle[]>> {
    return this.fail()
  }

  closes(): Promise<FuturesDataResult<FuturesRawClose[]>> {
    return this.fail()
  }
}
