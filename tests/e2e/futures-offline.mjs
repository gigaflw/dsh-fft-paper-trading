#!/usr/bin/env node
/**
 * 离线端到端：期货账户（真账本 + 真服务 + 真 RPC handler + 假行情）。
 *
 *   node tests/e2e/futures-offline.mjs
 *
 * 不启应用、不碰 ~/.dsh；数据写 tmp/。退出码 0 = 全过。
 * 覆盖：首日开多、保证金/现金/权益、持仓、进程重启重放、次日平仓、
 * 15:30 日结算、收盘后拒单、账本落盘。
 */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FuturesRepo, FuturesService, WeekdayTradingCalendar, createFuturesRpcHandler,
} from '../../lib/index.js'
import { CONTRACT, SYMBOL, clockAt, makeFakeData, makeHome, AM, PM, SETTLEMENT } from '../futures-fixtures.mjs'

const failures = []
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const home = makeHome('e2e-futures')
const ledger = join(home, 'paper-trading', 'futures', 'events.jsonl')
const date1 = '2026-10-19'
const date2 = '2026-10-20'
let nowMs = clockAt(date1, AM).getTime()
const now = () => new Date(nowMs)
const make = () => {
  const repo = new FuturesRepo({ home })
  const data = makeFakeData()
  const service = new FuturesService({ repo, data, calendar: new WeekdayTradingCalendar(), now })
  return { repo, data, service, rpc: createFuturesRpcHandler(service) }
}

await rm(home, { recursive: true, force: true })
{
  const first = make()
  const call = (endpoint, payload) => first.rpc(endpoint, payload, new AbortController().signal)
  const account = (await call('futures/account/get')).value
  assert('initial cash is 1,000,000', account.cash === 1_000_000, JSON.stringify(account))
  assert('initial risk is 0', account.riskRatio === 0)
  assert('initial trade date', account.tradeDate === date1, account.tradeDate)

  const contracts = (await call('futures/contracts', { query: 'rb' })).value
  assert('contract search returns the contract', contracts.state === 'ok' && contracts.contracts.length === 1 && contracts.contracts[0].symbol === SYMBOL, JSON.stringify(contracts))
  assert('contract view carries terms', contracts.contracts[0].multiplier === CONTRACT.multiplier && contracts.contracts[0].tickSize === CONTRACT.tickSize)

  const quotes = (await call('futures/quote', { symbols: [SYMBOL] })).value
  assert('quote by symbol', quotes.state === 'ok' && quotes.quotes[0].last === 3200, JSON.stringify(quotes))

  const status = (await call('futures/status')).value
  assert('day session can trade', status.canSubmit === true && status.canMatch === true, JSON.stringify(status))

  const draft = { symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }
  const preview = (await call('futures/preview', draft)).value
  assert('preview margin', preview.marginCents === 320_000, String(preview.marginCents))
  assert('preview fees', preview.feesCents === 300, String(preview.feesCents))
  assert('preview max lots', preview.maxOpenQty > 0, String(preview.maxOpenQty))
  assert('preview risk after', Math.abs(preview.riskRatioAfter - 0.0032) < 0.0001, String(preview.riskRatioAfter))
  assert('preview limit band', preview.limit?.upper === 3400 && preview.limit?.lower === 3000, JSON.stringify(preview.limit))

  const placed = await call('futures/order', { draft, requestId: 'futures-e2e-open' })
  assert('open order fills', placed.ok === true && placed.value.status === 'filled', JSON.stringify(placed))
  const order = placed.value
  assert('fill price is the last price', order.fillPrice === 3200, String(order.fillPrice))

  const afterOpen = (await call('futures/account/get')).value
  assert('margin reserved', afterOpen.margin === 3_200, String(afterOpen.margin))
  assert('cash paid margin and fees', afterOpen.cash === 1_000_000 - 3_200 - 3, String(afterOpen.cash))
  assert('equity pays the open fee', afterOpen.equity === 1_000_000 - 3, String(afterOpen.equity))

  const positions = (await call('futures/positions')).value
  assert('one long position', positions.length === 1 && positions[0].side === 'long' && positions[0].qty === 1, JSON.stringify(positions))
  assert('position carries margin', positions[0].marginCents === 320_000)

  const raw = await readFile(ledger, 'utf8')
  assert('ledger has the fill', raw.includes('order.filled'))
  assert('ledger has the request id', raw.includes('futures-e2e-open'))

  // --- restart: a fresh repo on the same home must replay to the same state ---
  const restarted = make()
  const restartedAccount = (await restarted.rpc('futures/account/get', {}, new AbortController().signal)).value
  const restartedPositions = (await restarted.rpc('futures/positions', {}, new AbortController().signal)).value
  assert('restart replays cash', restartedAccount.cash === afterOpen.cash, `${restartedAccount.cash} !== ${afterOpen.cash}`)
  assert('restart replays margin', restartedAccount.margin === afterOpen.margin)
  assert('restart replays positions', JSON.stringify(restartedPositions) === JSON.stringify(positions))

  // --- next day: close the long, then settle at 15:30 ---
  nowMs = clockAt(date2, AM).getTime()
  const closeDraft = { symbol: SYMBOL, side: 'long', offset: 'close', type: 'market', qty: 1 }
  const closed = await restarted.rpc('futures/order', { draft: closeDraft, requestId: 'futures-e2e-close' }, new AbortController().signal)
  assert('close order fills', closed.ok === true && closed.value.status === 'filled', JSON.stringify(closed))
  const afterClose = (await restarted.rpc('futures/account/get', {}, new AbortController().signal)).value
  assert('margin released', afterClose.margin === 0, String(afterClose.margin))
  assert('positions flat', (await restarted.rpc('futures/positions', {}, new AbortController().signal)).value.length === 0)
  assert('cash returns the margin and pays the close fee', afterClose.cash === 1_000_000 - 6, String(afterClose.cash))

  nowMs = clockAt(date2, SETTLEMENT).getTime()
  const tick = (await restarted.rpc('futures/tick', {}, new AbortController().signal)).value
  assert('settlement tick returns a notice or empty fill', Array.isArray(tick.notices) && Array.isArray(tick.filled))
  const afterSettle = (await restarted.rpc('futures/account/get', {}, new AbortController().signal)).value
  assert('trade day rolls after settlement', afterSettle.tradeDate > date2, `${afterSettle.tradeDate} <= ${date2}`)
  const rawAfter = await readFile(ledger, 'utf8')
  assert('ledger records day.closed', rawAfter.includes('day.closed'))

  // --- closed session: preview is read-only, order is rejected ---
  nowMs = clockAt(date2, 20 * 60).getTime()
  const closedStatus = (await restarted.rpc('futures/status', {}, new AbortController().signal)).value
  assert('evening is not tradeable', closedStatus.canSubmit === false, JSON.stringify(closedStatus))
  const late = await restarted.rpc('futures/order', {
    draft: { symbol: SYMBOL, side: 'long', offset: 'open', type: 'market', qty: 1 }, requestId: 'futures-e2e-late',
  }, new AbortController().signal)
  assert('closed session order is rejected', late.ok === false && late.error.code === 'SESSION_CLOSED', JSON.stringify(late))
}

await rm(home, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nfutures offline e2e: all checks passed')
