/**
 * `compare/get`: the numbers behind the comparison page.
 *
 * Every visible account is read through its own service — `account()` for the
 * snapshot and `review('all')` for the drawdown and the daily equity curve.
 * Both are read paths: they only fetch quotes when a day boundary is due (the
 * first read after 15:00 or after the next open), so ordinary polling spends no
 * market-data quota but the first read of a new trading day may take one
 * boundary snapshot per account.
 * @module @dsh-ft/dsh-fft-paper-trading/service/compare-rpc
 */

import type { AccountMeta, CompareRow, CompareView } from '../contract.js'
import { PaperError } from './errors.js'
import type { PaperService } from './paper-service.js'
import type { PaperRpcHandler } from './rpc.js'
import { fail, ok } from './rpc-support.js'

export interface CompareSource {
  /** Visible (not hidden) stock accounts, in registry order. */
  accounts: () => Promise<AccountMeta[]>
  serviceOf: (meta: AccountMeta) => PaperService
}

/** Routes `compare/get`; other endpoints belong to the per-account handlers. */
export function createCompareRpcHandler(source: CompareSource): PaperRpcHandler {
  return async endpoint => {
    if (endpoint !== 'compare/get') {
      return fail('INVALID_ARGUMENT', `未知端点 ${endpoint}`)
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
