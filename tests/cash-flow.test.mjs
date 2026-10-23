import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { DEFAULT_SETTINGS } from '../lib/contract.js'
import { DEFAULT_FUTURES_SETTINGS } from '../lib/futures-contract.js'
import { emptyState, verify } from '../lib/core/ledger.js'
import { depositCash, openAccount, withdrawCash } from '../lib/core/engine.js'
import { replay } from '../lib/core/replay.js'
import { toAccountView } from '../lib/core/views.js'
import { PaperService } from '../lib/service/paper-service.js'
import { createPaperRpcHandler } from '../lib/service/rpc.js'
import { AccountRepo } from '../lib/store/repo.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { emptyState as emptyFuturesState, verify as verifyFutures } from '../lib/core/futures/ledger.js'
import {
  depositCash as futuresDeposit,
  openAccount as openFuturesAccount,
  withdrawCash as futuresWithdraw,
} from '../lib/core/futures/engine.js'
import { replayFutures } from '../lib/core/futures/replay.js'
import { cashFlowViews, toAccountView as toFuturesAccountView } from '../lib/core/futures/views.js'
import { FuturesService } from '../lib/service/futures-service.js'
import { createFuturesRpcHandler } from '../lib/service/futures-rpc.js'
import { FuturesRepo } from '../lib/store/futures-repo.js'
import { AM, DATE1, clockAt, makeFakeData, makeHome } from './futures-fixtures.mjs'

const NOW = new Date('2026-10-19T02:00:00.000Z') // Monday 10:00 Shanghai
const DAY1 = '2026-10-19'
const DAY2 = '2026-10-20'

function makeData() {
  return {
    async quotes() {
      return { state: 'failed', quotes: [], notice: 'no quote' }
    },
    async dailyBars() {
      return { state: 'ok', bars: [] }
    },
    async minuteBars() {
      return { state: 'ok', bars: [] }
    },
    async search() {
      return []
    },
    async marketList() {
      return { state: 'ok', quotes: [], page: 1 }
    },
  }
}

function stockHome(name) {
  return makeHome(name)
}

const signal = () => new AbortController().signal

test('cash: stock deposit and withdrawal replay into cash and verify', () => {
  const opened = openAccount(emptyState('default'), DEFAULT_SETTINGS, DAY1, NOW.toISOString(), 'default')
  const deposited = depositCash(opened.state, 2_000_000, NOW.toISOString())
  const withdrawn = withdrawCash(deposited.state, 500_000, NOW.toISOString())
  const { state, issues } = replay([...opened.events, ...deposited.events, ...withdrawn.events], 'default')
  assert.deepEqual(issues, [])
  assert.equal(state.cashCents, 11_500_000)
  assert.equal(state.cashFlows.length, 2)
  assert.deepEqual(state.cashFlows.map(flow => flow.type), ['deposit', 'withdraw'])
  // The invariant checks the running cash against initial + flows + fills.
  assert.deepEqual(verify(state), [])

  assert.throws(() => withdrawCash(state, 11_500_001, NOW.toISOString()), /exceeds cash/)
  assert.throws(() => depositCash(state, 0, NOW.toISOString()), /positive integer/)
  assert.throws(() => depositCash(state, 10.5, NOW.toISOString()), /positive integer/)
})

test('cash: stock view counts contributions as capital, not profit', () => {
  const state = emptyState('default')
  state.initialCashCents = 10_000_000
  state.cashCents = 12_300_000
  state.tradeDate = DAY2
  // Yesterday closed at the initial capital, so today's equity change is
  // 2,000,000 deposited + 300,000 earned.
  state.dayEquity = [{ date: DAY1, equityCents: 10_000_000, cashCents: 10_000_000 }]
  state.cashFlows = [{ ts: NOW.toISOString(), type: 'deposit', amountCents: 2_000_000, tradeDate: DAY2 }]
  const view = toAccountView(state)
  assert.equal(view.equity, 123_000)
  assert.equal(view.netCashFlow, 20_000)
  assert.equal(view.pnl, 3_000)
  assert.equal(view.pnlPct, 0.025)
  assert.equal(view.todayPnl, 3_000)
})

test('cash: stock service and RPC move cash, log the flow and reject over-withdrawal', async () => {
  const home = stockHome('cash-rpc')
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data: makeData(), calendar: new WeekdayTradingCalendar(), now: () => NOW })
  const handler = createPaperRpcHandler(service)
  try {
    let result = await handler('account/deposit', { amount: 20000 }, signal())
    assert.equal(result.ok, true)
    assert.equal(result.value.cash, 120_000)
    assert.equal(result.value.netCashFlow, 20_000)
    assert.equal(result.value.pnl, 0)
    assert.equal(result.value.todayPnl, 0)
    const afterDeposit = await repo.current()
    assert.deepEqual(verify(afterDeposit), [])
    assert.equal(afterDeposit.cashCents, 12_000_000)

    result = await handler('account/withdraw', { amount: 5000 }, signal())
    assert.equal(result.ok, true)
    assert.equal(result.value.cash, 115_000)
    assert.equal(result.value.netCashFlow, 15_000)

    const flow = await service.cashFlow()
    assert.deepEqual(flow.map(row => row.type), ['open', 'deposit', 'withdraw'])
    assert.equal(flow[1].amount, 20_000)
    assert.equal(flow[2].amount, -5_000)
    assert.equal(flow[2].balance, 115_000)

    const before = (await repo.current()).cashCents
    result = await handler('account/withdraw', { amount: 999_999 }, signal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INSUFFICIENT_CASH')
    // A rejected withdrawal writes nothing.
    assert.equal((await repo.current()).cashCents, before)

    result = await handler('account/deposit', { amount: 0 }, signal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_ARGUMENT')
    result = await handler('account/deposit', {}, signal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_ARGUMENT')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('cash: futures deposit adds free cash and replays exactly', () => {
  const opened = openFuturesAccount(emptyFuturesState('futures'), DEFAULT_FUTURES_SETTINGS, DAY1, NOW.toISOString(), 'futures')
  const deposited = futuresDeposit(opened.state, 50_000_000, NOW.toISOString())
  const { state, issues } = replayFutures([...opened.events, ...deposited.events], 'futures')
  assert.deepEqual(issues, [])
  assert.equal(state.cashCents, 150_000_000)

  const view = toFuturesAccountView(state)
  assert.equal(view.cash, 1_500_000)
  assert.equal(view.equity, 1_500_000)
  assert.equal(view.netCashFlow, 500_000)
  assert.equal(view.pnl, 0)
  assert.equal(view.todayPnl, 0)

  assert.deepEqual(cashFlowViews(state).map(row => row.type), ['open', 'deposit'])
  assert.throws(() => futuresWithdraw(state, 200_000_000, NOW.toISOString()), /exceeds free cash/)
  assert.deepEqual(verifyFutures(state), [])
})

test('cash: futures service and RPC move free cash and reject over-withdrawal', async () => {
  const home = makeHome('futures-cash-rpc')
  let now = clockAt(DATE1, AM)
  const repo = new FuturesRepo({ home })
  const service = new FuturesService({
    repo,
    data: makeFakeData(),
    calendar: new WeekdayTradingCalendar(),
    now: () => now,
  })
  const handler = createFuturesRpcHandler(service)
  try {
    let result = await handler('futures/account/deposit', { amount: 10000 }, signal())
    assert.equal(result.ok, true)
    assert.equal(result.value.cash, 1_010_000)
    assert.equal(result.value.netCashFlow, 10_000)
    assert.equal(result.value.pnl, 0)

    const flow = await service.cashFlow()
    assert.deepEqual(flow.map(row => row.type), ['open', 'deposit'])
    assert.deepEqual(verifyFutures(await repo.current()), [])

    result = await handler('futures/account/withdraw', { amount: 1_000_000_000 }, signal())
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INSUFFICIENT_CASH')

    result = await handler('futures/account/withdraw', { amount: 5000 }, signal())
    assert.equal(result.ok, true)
    assert.equal(result.value.cash, 1_005_000)
    assert.equal(result.value.netCashFlow, 5_000)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
