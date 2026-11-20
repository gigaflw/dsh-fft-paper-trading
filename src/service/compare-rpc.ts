/**
 * `compare/get`: the numbers behind the comparison page.
 *
 * Every visible account is read through its own service — `account()` for the
 * snapshot and `review('all')` for the drawdown and the daily equity curve.
 * Neither needs quotes outside the day boundaries, so polling this endpoint
 * does not spend market-data quota.
 * @module @dsh-ft/dsh-fft-paper-trading/service/compare-rpc
 */

import type { AccountMeta, CompareRow, CompareView, RpcResult } from '../contract.js'
import { PaperError } from './errors.js'
import type { PaperService } from './paper-service.js'
import type { PaperRpcHandler } from './rpc.js'

export interface CompareSource {
  /** Visible (not hidden) stock accounts, in registry order. */
  accounts: () => Promise<AccountMeta[]>
  serviceOf: (meta: AccountMeta) => PaperService
}

const ok = <T>(value: T): RpcResult<T> => ({ ok: true, value })

/** Routes `compare/get`; other endpoints belong to the per-account handlers. */
export function createCompareRpcHandler(source: CompareSource): PaperRpcHandler {
  return async endpoint => {
    if (endpoint !== 'compare/get') {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: `未知端点 ${endpoint}` } }
    }
    try {
      const accounts: CompareRow[] = []
      for (const meta of await source.accounts()) {
        const service = source.serviceOf(meta)
        try {
          const [account, review] = await Promise.all([service.account(), service.review('all')])
          accounts.push({
            id: meta.id,
            name: meta.name,
            locked: meta.locked === true,
            ...(meta.missing === true ? { missing: true } : {}),
            initialCash: account.initialCash,
            equity: account.equity,
            pnl: account.pnl,
            pnlPct: account.pnlPct,
            todayPnl: account.todayPnl,
            maxDrawdownPct: review.maxDrawdownPct,
            tradeCount: review.tradeCount,
            points: review.equityCurve,
          })
        } catch {
          // One broken ledger must not blank the whole board: surface the row
          // as missing instead of failing every other account with it.
          accounts.push({
            id: meta.id,
            name: meta.name,
            locked: meta.locked === true,
            missing: true,
            initialCash: 0,
            equity: 0,
            pnl: 0,
            pnlPct: 0,
            todayPnl: 0,
            maxDrawdownPct: 0,
            tradeCount: 0,
            points: [],
          })
        }
      }
      const view: CompareView = { accounts }
      return ok(view)
    } catch (error) {
      if (error instanceof PaperError) return { ok: false, error: { code: error.code, message: error.message } }
      return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}
