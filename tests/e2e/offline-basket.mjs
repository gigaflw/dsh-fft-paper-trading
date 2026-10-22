#!/usr/bin/env node
/**
 * 离线端到端：一揽子买入（真账本 + 真服务 + 真 RPC handler + 假行情）。
 *
 *   node tests/e2e/offline-basket.mjs
 *
 * 不启应用、不碰 ~/.dsh；数据写 tmp/。退出码 0 = 全过。
 * 覆盖：CSV 预览、费用/整手/剩余现金、RPC 下单、逐行成交、账本落盘、
 * 同 batchId 幂等、收盘后整批拒绝。
 */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AccountRepo, PaperService, WeekdayTradingCalendar, createPaperRpcHandler } from '../../lib/index.js'

const tmp = new URL('./tmp-basket-home/', import.meta.url)
const home = tmp.pathname
const ledger = join(home, 'paper-trading', 'default', 'events.jsonl')
const failures = []
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const NOW = '2026-10-22T10:05:00+08:00'
const prices = { '600519': 1450.5, '000001': 11.3, '300750': 240 }
const data = {
  async quotes(symbols) {
    return {
      state: 'ok',
      quotes: symbols.map(symbol => ({
        symbol,
        name: symbol,
        last: prices[symbol.split('.')[0]] ?? 10,
        prevClose: (prices[symbol.split('.')[0]] ?? 10) * 0.99,
        marketTs: NOW,
        fetchedAt: NOW,
        source: 'fake',
      })),
    }
  },
  async dailyBars() { return { state: 'ok', bars: [] } },
  async minuteBars() { return { state: 'ok', bars: [] } },
  async search() { return [] },
  async marketList() { return { state: 'ok', quotes: [], page: 1, pageSize: 50 } },
}

const clock = iso => () => new Date(iso)
const makeService = (now = NOW) => {
  const repo = new AccountRepo({ home, accountId: 'default' })
  return { repo, service: new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: clock(now) }) }
}

const csv = ['代码,权重', '600519,30%', '000001,20%', '300750,50%', ''].join('\n')

await rm(home, { recursive: true, force: true })
{
  const { service } = makeService()
  const rpc = createPaperRpcHandler(service)
  const previewResult = await rpc('basket/preview', { csv, budgetCents: 100_000_000 }, new AbortController().signal)
  assert('preview ok', previewResult.ok === true, JSON.stringify(previewResult))
  const preview = previewResult.value
  assert('three rows', preview.rows.length === 3)
  assert('all weighted', Math.abs(preview.rows.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-9)
  assert('lots are 100-share multiples', preview.rows.every(row => row.qty % 100 === 0))
  assert('statuses known', preview.rows.every(row => ['ok', 'zero_lot', 'no_quote', 'suspended'].includes(row.status)))
  assert('budget not exceeded', preview.totalAmountCents + preview.totalFeesCents <= preview.budgetCents)
  assert('residual reconciles', preview.residualCents === preview.budgetCents - preview.totalAmountCents - preview.totalFeesCents)
  assert('cash after reconciles', preview.cashAfterCents === preview.cashCents - preview.totalAmountCents - preview.totalFeesCents)
  assert('session allows matching', preview.session.canMatch === true)

  const placeable = preview.rows.filter(row => row.qty > 0).map(row => ({ symbol: row.symbol, qty: row.qty }))
  const batchId = 'basket-e2e-1'
  const placeResult = await rpc('basket/place', { batchId, rows: placeable }, new AbortController().signal)
  assert('place ok', placeResult.ok === true, JSON.stringify(placeResult))
  const placed = placeResult.value
  assert('one result per row', placed.rows.length === placeable.length)
  assert('all filled', placed.rows.every(row => row.order && row.order.status === 'filled'))
  assert('batchId echoed', placed.batchId === batchId)

  const orders = await service.orders()
  assert('orders recorded', orders.length === placeable.length)
  assert('cash decreased', (await service.account()).cash < 1_000_000)

  const raw = await readFile(ledger, 'utf8')
  assert('ledger has order.filled', raw.includes('order.filled'))
  assert('ledger has requestId', raw.includes(`${batchId}:`))

  const retry = await rpc('basket/place', { batchId, rows: placeable }, new AbortController().signal)
  assert('retry ok', retry.ok === true)
  const after = await service.orders()
  assert('retry does not duplicate orders', after.length === orders.length)
  const firstIds = placed.rows.map(row => row.order.id).sort().join(',')
  const retryIds = retry.value.rows.map(row => row.order.id).sort().join(',')
  assert('retry reuses the same orders', firstIds === retryIds, `${firstIds} !== ${retryIds}`)
}

{
  // 收盘后：预览仍可看，下单必须整批拒绝且不写订单。
  const { service } = makeService('2026-10-22T20:00:00+08:00')
  const rpc = createPaperRpcHandler(service)
  const preview = (await rpc('basket/preview', { csv }, new AbortController().signal)).value
  assert('closed preview still works', preview !== undefined && preview.rows.length === 3)
  const before = (await service.orders()).length
  const blocked = await rpc('basket/place', {
    rows: preview.rows.filter(row => row.qty > 0).map(row => ({ symbol: row.symbol, qty: row.qty })),
  }, new AbortController().signal)
  assert('closed place rejected', blocked.ok === false)
  assert('closed rejection code', blocked.ok === false && ['SESSION_CLOSED', 'AUCTION_ONLY'].includes(blocked.error.code), blocked.ok === false ? blocked.error.code : '')
  assert('no orders written when closed', (await service.orders()).length === before)
}

await rm(home, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nbasket offline e2e: all checks passed')
