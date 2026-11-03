import test from 'node:test'
import assert from 'node:assert/strict'
import { FtshareTradingCalendar, CALENDAR_RETRY_MAX_MS } from '../lib/data/ftshare-trading-calendar.js'
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

/** An `available` answer carrying the given `YYYY-MM-DD` days. */
function ok(days) {
  return { ok: true, state: 'available', rows: [{ trade_dates: days.map(day => Number(day.replaceAll('-', ''))) }] }
}

const QUOTA = { ok: false, state: 'failed', rows: [], notice: { code: 'UPSTREAM_UNAVAILABLE', message: '最近 1 天最多访问 500 次', retryable: false } }
const OK = ok(['2026-10-26', '2026-10-27'])

test('calendar adapter: a year is fetched once, whatever range the 5 s tick asks for', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const { service, calls } = fakeService([ok(['2026-10-23', '2026-10-26', '2026-10-27'])])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current })

  assert.deepEqual(await calendar.tradingDays('2026-10-26', '2026-10-27'), ['2026-10-26', '2026-10-27'])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, { market: 'cn', start_date: 20260101, end_date: 20261231 }, 'one call covers the whole year')
  assert.equal(calendar.source, 'ftshare')

  // Different ranges, the same day, back-to-back ticks: all served from memory.
  assert.equal(await calendar.isTradingDay('2026-10-26'), true)
  assert.equal(await calendar.isTradingDay('2026-10-25'), false)
  assert.equal(await calendar.nextTradingDay('2026-10-26'), '2026-10-27')
  await calendar.tradingDays('2026-03-01', '2026-03-31')
  assert.equal(calls.length, 1, 'a year is asked once, not once per range')

  // Concurrent ticks during one upstream question share that question.
  const slow = new FtshareTradingCalendar(fakeService([ok(['2027-01-04', '2027-01-05'])]).service, { now: () => new Date('2027-01-04T01:00:00.000Z') })
  const [left, right] = await Promise.all([slow.isTradingDay('2027-01-04'), slow.tradingDays('2027-01-04', '2027-01-05')])
  assert.equal(left, true)
  assert.deepEqual(right, ['2027-01-04', '2027-01-05'])
})

test('calendar adapter: a failure is cached, backs off, and keeps saying why', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const transient = { ok: false, state: 'failed', rows: [], notice: { code: 'TRANSPORT', message: '连接超时', retryable: true } }
  const { service, calls } = fakeService([transient, transient, OK])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current, retryMs: 60_000 })

  const first = await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.deepEqual(first, ['2026-10-26', '2026-10-27'], 'weekday fallback still answers')
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /连接超时/)
  assert.equal(calendar.status.checkedAt, now.current.toISOString())
  assert.equal(calls.length, 1)

  // Inside the backoff the estimate is served without asking upstream again:
  // the eleven 5 s ticks left in the minute must not become eleven questions.
  for (let i = 0; i < 11; i += 1) {
    now.current = new Date(now.current.getTime() + 5_000)
    await calendar.tradingDays('2026-10-26', '2026-10-27')
  }
  assert.equal(calls.length, 1, 'the failure is remembered, not re-asked every tick')

  // The second failure doubles the gap: 60 s is no longer enough.
  now.current = new Date('2026-10-26T01:01:01.000Z')
  await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.equal(calls.length, 2)
  now.current = new Date('2026-10-26T01:01:50.000Z')
  await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.equal(calls.length, 2, 'still inside the doubled 120 s window')

  // After the doubled window the retry succeeds and the status flips back.
  now.current = new Date('2026-10-26T01:03:02.000Z')
  const recovered = await calendar.tradingDays('2026-10-26', '2026-10-27')
  assert.deepEqual(recovered, ['2026-10-26', '2026-10-27'])
  assert.equal(calls.length, 3)
  assert.equal(calendar.source, 'ftshare')
  assert.equal(calendar.status.reason, undefined)

  // A successful year is cached: no further upstream calls for that year.
  await calendar.tradingDays('2026-10-26', '2026-10-27')
  await calendar.isTradingDay('2026-10-28')
  assert.equal(calls.length, 3)
})

test('calendar adapter: the backoff is capped', async () => {
  assert.equal(CALENDAR_RETRY_MAX_MS, 600_000)
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const transient = { ok: false, state: 'failed', rows: [], notice: { code: 'TRANSPORT', message: '连接超时', retryable: true } }
  const { service, calls } = fakeService([transient])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current, retryMs: 60_000 })

  // Failures 1..6 would need 1,2,4,8,16,32 min; the cap holds it at 10 min.
  for (let i = 0; i < 6; i += 1) {
    now.current = new Date(now.current.getTime() + CALENDAR_RETRY_MAX_MS)
    await calendar.tradingDays('2026-10-26', '2026-10-26')
  }
  const afterSix = calls.length
  now.current = new Date(now.current.getTime() + CALENDAR_RETRY_MAX_MS - 1_000)
  await calendar.tradingDays('2026-10-26', '2026-10-26')
  assert.equal(calls.length, afterSix, 'the gap never exceeds the cap, so nothing happens just below it')
})

test('calendar adapter: a quota answer is not retried again that natural day', async () => {
  const now = { current: new Date('2026-10-26T00:30:00.000Z') } // 08:30 Shanghai
  const { service, calls } = fakeService([QUOTA, OK])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current })

  assert.deepEqual(await calendar.tradingDays('2026-10-26', '2026-10-27'), ['2026-10-26', '2026-10-27'])
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /500 次/, 'the quota wording stays visible')
  assert.match(calendar.status.reason, /不再重试/)
  assert.equal(calls.length, 1)

  // Hours later, still the same Shanghai natural day: no retry at all, even
  // though the ordinary backoff ceiling (10 min) has long passed.
  now.current = new Date('2026-10-26T07:00:00.000Z') // 15:00 Shanghai
  await calendar.tradingDays('2026-10-26', '2026-10-26')
  assert.equal(calls.length, 1, 'quota failures must not keep spending the window')

  // Past midnight Shanghai the window is a new one, so the adapter may ask again.
  now.current = new Date('2026-10-26T16:05:00.000Z') // 00:05 Shanghai on the 27th
  const next = await calendar.tradingDays('2026-10-27', '2026-10-27')
  assert.deepEqual(next, ['2026-10-27'])
  assert.equal(calls.length, 2)
  assert.equal(calendar.source, 'ftshare')
})

test('calendar adapter: denied and failed answers are both degradations', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const denied = { ok: false, state: 'denied', rows: [], notice: { code: '401', message: 'API Key 缺失', retryable: false } }
  const { service } = fakeService([denied])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current, retryMs: 60_000 })
  const days = await calendar.isTradingDay('2026-10-26')
  assert.equal(days, true, 'a Monday stays a trading day in the estimate')
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /API Key/)
})

test('calendar adapter: an empty year is a failure, not a calendar without trading days', async () => {
  const now = { current: new Date('2026-10-26T01:00:00.000Z') }
  const { service, calls } = fakeService([ok([])])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current })
  assert.equal(await calendar.isTradingDay('2026-10-26'), true)
  assert.equal(calendar.source, 'fallback')
  assert.match(calendar.status.reason, /未返回 2026 年交易日历/)
  assert.equal(calls.length, 1)
})

test('calendar adapter: a range across the new year asks each year once', async () => {
  const now = { current: new Date('2026-12-30T02:00:00.000Z') }
  // 2027-01-01 is a Friday (a weekday); the upstream's later entries are the
  // holiday-aware ones, so the answer proves which source replied.
  const { service, calls } = fakeService([ok([])])
  const calendar = new FtshareTradingCalendar(service, { now: () => now.current })
  // A range that straddles midnight on 31 December needs both years.
  await calendar.tradingDays('2026-12-31', '2027-01-05')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.args.start_date), [20260101, 20270101])
})

test('calendar adapter: the weekday fallback reports why it is in use', async () => {
  const status = new WeekdayTradingCalendar().status
  assert.equal(status.source, 'fallback')
  assert.match(status.reason, /未接入/)

  const custom = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算')
  assert.match(custom.status.reason, /未安装/)
})
