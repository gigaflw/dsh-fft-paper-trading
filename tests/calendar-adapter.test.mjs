import test from 'node:test'
import assert from 'node:assert/strict'
import { FtshareTradingCalendar } from '../lib/data/ftshare-trading-calendar.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'

function fakeService(outcomes) {
  const calls = []
  return {
    calls,
    service: {
      async listTools() { return [] },
      async call(name, args) {
        calls.push({ name, args })
        const next = outcomes.length > 1 ? outcomes.shift() : outcomes[0]
        return next
      },
    },
  }
}

const FAILED = { ok: false, state: 'failed', rows: [], notice: { code: 'UPSTREAM_UNAVAILABLE', message: '最近 1 天最多访问 500 次' } }
const OK = { ok: true, state: 'available', rows: [{ trade_dates: [20261026, 20261027] }] }

test('calendar adapter: a failure falls back without poisoning the cache, then recovers', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const { service, calls } = fakeService([FAILED, OK])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current, retryMs: 60_000 })

  const first = await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.deepEqual(first, ['2026-10-26', '2026-10-27'], 'weekday fallback still answers')
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /500 次/)
  assert.equal(calendar.status.checkedAt, now.current.toISOString())
  assert.equal(calls.length, 1)

  // Inside the retry window the fallback is served from memory: no hammering.
  const second = await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.deepEqual(second, first)
  assert.equal(calls.length, 1)

  // After the window the adapter retries and the status flips back.
  now.current = new Date('2026-10-26T01:02:00.000Z')
  const recovered = await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.deepEqual(recovered, ['2026-10-26', '2026-10-27'])
  assert.equal(calls.length, 2)
  assert.equal(calendar.source, 'ftshare')
  assert.equal(calendar.status.reason, undefined)

  // A successful answer is cached: no further upstream calls for that range.
  await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.equal(calls.length, 2)
})

test('calendar adapter: denied and failed answers are both degradations', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const denied = { ok: false, state: 'denied', rows: [], notice: { code: '401', message: 'API Key 缺失' } }
  const { service } = fakeService([denied])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current, retryMs: 60_000 })
  const days = await calendar.isTradingDay('2026-10-26')
  assert.equal(days, true, 'a Monday stays a trading day in the estimate')
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /API Key/)
})

test('calendar adapter: the weekday fallback reports why it is in use', async () => {
  const status = new WeekdayTradingCalendar().status
  assert.equal(status.source, 'fallback')
  assert.match(status.reason, /未接入/)

  const custom = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算')
  assert.match(custom.status.reason, /未安装/)
})
