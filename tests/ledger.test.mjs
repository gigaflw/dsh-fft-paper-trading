import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, PAPER_LEDGER_VERSION } from '../lib/contract.js'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { EventStore } from '../lib/store/event-store.js'
import { backupsDir, eventsPath } from '../lib/store/paths.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'
import { replay } from '../lib/core/replay.js'

const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+08:00`)

/** Daily bar whose close sits at 15:00 Asia/Shanghai on `date`. */
const bar = (date, close, extra = {}) => ({
  time: new Date(`${date}T15:00:00+08:00`).toISOString(),
  open: close,
  high: close,
  low: close,
  close,
  volume: 10_000,
  ...extra,
})

function makeHome(name) {
  return join(process.cwd(), 'tmp', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)
}

async function writeLedger(home, events) {
  const file = eventsPath(home, 'default')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8')
  return file
}

function makeData() {
  const quotes = new Map()
  const bars = new Map()
  const volumes = new Map()
  const pause = () => new Promise(resolve => setTimeout(resolve, 3))
  return {
    setQuote(symbol, price, ts, extra = {}) {
      const quote = { symbol, name: '贵州茅台', last: price, marketTs: ts, fetchedAt: ts, ...extra }
      quotes.set(symbol, quote)
      return quote
    },
    setBars(symbol, list) {
      bars.set(symbol, list)
    },
    setVolume(symbol, volume) {
      volumes.set(symbol, volume)
    },
    async quotes(symbols) {
      await pause()
      const rows = symbols.map(symbol => quotes.get(symbol)).filter(Boolean)
      return rows.length > 0 ? { state: 'ok', quotes: rows } : { state: 'failed', quotes: [], notice: 'no quote' }
    },
    async dailyBars(symbol) {
      await pause()
      return { state: 'ok', bars: bars.get(symbol) ?? [] }
    },
    async minuteBars(symbol, date) {
      const volume = volumes.get(symbol)
      if (volume === undefined) return { state: 'ok', bars: [] }
      return { state: 'ok', bars: [{ time: `${date}T02:00:00.000Z`, open: 10, high: 10, low: 10, close: 10, volume }] }
    },
    async search() {
      return []
    },
    async marketList() {
      return { state: 'ok', quotes: [], page: 1 }
    },
  }
}

function makeService(home, data, now) {
  const repo = new AccountRepo({ home, accountId: 'default' })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now.current })
  return { repo, service }
}

function boundaryEvents(events, type, date) {
  return events.filter(event => {
    if (event.type !== type) return false
    return type === 'day.closed' ? event.payload.date === date : (event.payload.date ?? event.payload.at) === date
  })
}

test('p0-1: five concurrent reads write each day-boundary event once', async () => {
  const home = makeHome('concurrent-reads')
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const { service } = makeService(home, data, now)
  try {
    data.setQuote('600519.SH', 10, now.current.toISOString())
    await service.account()
    await service.place({ symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })

    now.current = at('2026-10-22', '09:31')
    data.setQuote('600519.SH', 10.2, now.current.toISOString(), { prevClose: 10 })
    await Promise.all([
      service.account(),
      service.orders(),
      service.trades(),
      service.review('all'),
      service.tick(),
      service.marketStatus(),
    ])

    const store = new EventStore(eventsPath(home, 'default'))
    const { events } = await store.readAll()
    for (let i = 1; i < events.length; i += 1) {
      assert.ok(events[i].seq > events[i - 1].seq, `seq must strictly increase: ${events[i - 1].seq} → ${events[i].seq}`)
    }
    assert.equal(boundaryEvents(events, 'day.closed', '2026-10-21').length, 1, 'day.closed for 2026-10-21 must be written once')
    assert.equal(boundaryEvents(events, 'day.pre_opened', '2026-10-22').length, 1, 'day.pre_opened must be written once')
    assert.equal(boundaryEvents(events, 'day.opened', '2026-10-22').length, 1, 'day.opened must be written once')
    assert.equal(events.filter(event => event.type === 'ledger.violation').length, 0, 'no violation may be recorded')

    const replayed = replay(events, 'default')
    assert.deepEqual(replayed.issues, [])
    assert.equal(replayed.state.blocked, false)

    // A restart must load the same ledger without locking the account.
    const restarted = makeService(home, data, now)
    const account = await restarted.service.account()
    assert.equal(account.blocked, false)
    assert.equal(account.tradeDate, '2026-10-22')
    assert.equal(account.cash, 98_994.99)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p0-1: append refuses a non-contiguous seq instead of corrupting the file', async () => {
  const home = makeHome('seq-invariant')
  const file = await writeLedger(home, [
    {
      seq: 1,
      id: 'evt-1',
      ts: '2026-10-19T02:00:00.000Z',
      type: 'account.opened',
      payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-19', ledgerVersion: PAPER_LEDGER_VERSION },
    },
  ])
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    await repo.current()
    await assert.rejects(
      repo.append([{ seq: 3, id: 'evt-3', ts: '2026-10-19T02:01:00.000Z', type: 'day.pre_opened', payload: { date: '2026-10-20', at: '2026-10-20T01:15:00.000Z' } }]),
      /序号|sequence|seq/i,
    )
    const content = await readFile(file, 'utf8')
    assert.equal(content.trim().split('\n').length, 1, 'a rejected append must not touch the ledger')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p0-1: an old ledger with identical duplicate seq is repaired, not locked', async () => {
  const home = makeHome('duplicate-repair')
  const opened = {
    seq: 1,
    id: 'evt-1',
    ts: '2026-10-19T02:00:00.000Z',
    type: 'account.opened',
    payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-19', ledgerVersion: PAPER_LEDGER_VERSION },
  }
  const closed = {
    seq: 2,
    id: 'evt-2',
    ts: '2026-10-19T07:00:00.000Z',
    type: 'day.closed',
    payload: { date: '2026-10-19', equityCents: 10_000_000, cashCents: 10_000_000, nextDate: '2026-10-20', recordedAt: '2026-10-19T07:00:01.000Z' },
  }
  // The 5× bug wrote the same boundary event five times; only `recordedAt`
  // differed between the copies because each read read the clock itself.
  const duplicate = { ...closed, payload: { ...closed.payload, recordedAt: '2026-10-19T07:00:02.000Z' } }
  await writeLedger(home, [opened, closed, closed, duplicate, closed])
  try {
    const data = makeData()
    const now = { current: at('2026-10-20', '10:00') }
    const { service } = makeService(home, data, now)
    const account = await service.account()
    assert.equal(account.blocked, false)

    const store = new EventStore(eventsPath(home, 'default'))
    const { events } = await store.readAll()
    for (let i = 1; i < events.length; i += 1) {
      assert.ok(events[i].seq > events[i - 1].seq, `repaired file must be contiguous: ${events[i - 1].seq} → ${events[i].seq}`)
    }
    assert.equal(events.filter(event => event.type === 'day.closed').length, 1, 'duplicates are dropped on load')
    const repaired = events.filter(event => event.type === 'ledger.repaired')
    assert.equal(repaired.length, 1)
    assert.equal(repaired[0].payload.dropped, 3)
    assert.deepEqual(replay(events, 'default').issues, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p0-1: a conflicting duplicate seq still blocks and stops appending', async () => {
  const home = makeHome('duplicate-conflict')
  const opened = {
    seq: 1,
    id: 'evt-1',
    ts: '2026-10-19T02:00:00.000Z',
    type: 'account.opened',
    payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-19', ledgerVersion: PAPER_LEDGER_VERSION },
  }
  const first = {
    seq: 2,
    id: 'evt-2',
    ts: '2026-10-19T07:00:00.000Z',
    type: 'day.closed',
    payload: { date: '2026-10-19', equityCents: 10_000_000, cashCents: 10_000_000, nextDate: '2026-10-20' },
  }
  const conflicting = {
    seq: 2,
    id: 'evt-2',
    ts: '2026-10-19T07:00:00.000Z',
    type: 'day.closed',
    payload: { date: '2026-10-19', equityCents: 9_000_000, cashCents: 9_000_000, nextDate: '2026-10-20' },
  }
  const file = await writeLedger(home, [opened, first, conflicting])
  try {
    const data = makeData()
    const now = { current: at('2026-10-20', '10:00') }
    const { service } = makeService(home, data, now)
    const account = await service.account()
    assert.equal(account.blocked, true)
    // A locked view must name the failing invariant and the file to repair.
    assert.match(account.blockedReason ?? '', /重复且内容不同/)
    assert.ok(account.ledgerPath?.endsWith('events.jsonl'), 'the locked view carries the ledger path')

    const status = await service.ledgerStatus()
    assert.equal(status.exists, true)
    assert.equal(status.blocked, true)
    assert.equal(status.blockedReason, account.blockedReason)

    // The lock reason, not the session gate, must explain a refused order.
    await assert.rejects(
      service.place({ symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 }),
      /账户已锁定，请重置后继续（事件序号重复且内容不同: 2）/,
    )

    const before = (await readFile(file, 'utf8')).trim().split('\n').length
    // Reads and ticks on a blocked account must not keep appending events
    // (the old code wrote a fresh ledger.violation every few seconds).
    await service.account()
    await service.tick()
    await service.orders()
    const events = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(events.length, before, 'a blocked ledger must not grow')
    // The conflicting event is still on disk: the loader must not silently drop it.
    assert.equal(events.filter(event => event.type === 'day.closed').length, 2)
    assert.equal(events.filter(event => event.type === 'ledger.violation').length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p0-2: an older ledger version is blocked instead of replayed', async () => {
  const home = makeHome('old-version')
  await writeLedger(home, [
    {
      seq: 1,
      id: 'evt-1',
      ts: '2026-10-20T02:00:00.000Z',
      type: 'account.opened',
      payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: PAPER_LEDGER_VERSION - 1 },
    },
  ])
  const data = makeData()
  const now = { current: at('2026-10-20', '10:00') }
  const { service } = makeService(home, data, now)
  try {
    const account = await service.account()
    assert.equal(account.blocked, true)
    assert.match(account.blockedReason ?? '', /账本版本 .* 不兼容/)
    // The lock is the whole answer: no order may enter an unreadable ledger.
    await assert.rejects(
      service.place({ symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 }),
      /账户已锁定/,
    )
    const reset = await service.reset(true)
    assert.equal(reset.blocked, false)
    assert.equal(reset.cash, 100_000)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p0-3: reset rewrites a single genesis event and survives a locked ledger', async () => {
  const home = makeHome('reset-broken')
  const file = await writeLedger(home, [
    {
      seq: 1,
      id: 'evt-1',
      ts: '2026-10-20T02:00:00.000Z',
      type: 'account.opened',
      payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: PAPER_LEDGER_VERSION },
    },
    {
      seq: 2,
      id: 'evt-2',
      ts: '2026-10-20T02:01:00.000Z',
      type: 'order.submitted',
      payload: {
        order: {
          id: 'ord-2026-10-20-2',
          requestId: 'r1',
          symbol: '600519.SH',
          side: 'buy',
          type: 'market',
          qty: 100,
          status: 'pending',
          createdAt: '2026-10-20T02:01:00.000Z',
          updatedAt: '2026-10-20T02:01:00.000Z',
          filledQty: 0,
          remainingQty: 100,
          tradeDate: '2026-10-20',
        },
        quote: { symbol: '600519.SH', last: 10, marketTs: '2026-10-20T02:01:00.000Z' },
      },
    },
    {
      seq: 3,
      id: 'evt-3',
      ts: '2026-10-20T02:01:00.000Z',
      type: 'order.filled',
      payload: {
        orderId: 'ord-2026-10-20-2',
        fill: {
          id: 'fill-ord-2026-10-20-2-1',
          orderId: 'ord-2026-10-20-2',
          symbol: '600519.SH',
          side: 'buy',
          price: 10,
          qty: null,
          amountCents: null,
          fees: { commissionCents: null, stampCents: null, transferCents: null, totalCents: null },
          ts: '2026-10-20T02:01:00.000Z',
          tradeDate: '2026-10-20',
        },
      },
    },
    {
      seq: 4,
      id: 'evt-4',
      ts: '2026-10-20T02:01:00.000Z',
      type: 'ledger.violation',
      payload: { check: 'write', expected: 'consistent', actual: '现金为负或非法: NaN' },
    },
  ])
  const original = await readFile(file, 'utf8')
  const data = makeData()
  const now = { current: at('2026-10-21', '10:00') }
  const { service } = makeService(home, data, now)
  try {
    const locked = await service.account()
    assert.equal(locked.blocked, true)
    assert.equal(locked.blockedReason, '现金为负或非法: NaN')

    const reset = await service.reset(true)
    assert.equal(reset.blocked, false)
    assert.equal(reset.blockedReason, undefined)
    assert.equal(reset.cash, 100_000)
    assert.equal(reset.initialCash, 100_000)
    assert.equal(reset.positions.length, 0)

    const rewritten = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(rewritten.length, 1, 'reset compacts the ledger to one genesis event')
    assert.equal(rewritten[0].type, 'account.reset')
    assert.equal(rewritten[0].seq, 1)
    assert.equal(rewritten[0].payload.initialCashCents, 10_000_000)
    assert.deepEqual(replay(rewritten, 'default').issues, [])

    const backups = await readdir(backupsDir(home, 'default'))
    assert.equal(backups.length, 1)
    const backup = await readFile(join(backupsDir(home, 'default'), backups[0]), 'utf8')
    assert.equal(backup, original, 'the backup keeps the pre-reset ledger byte for byte')

    // The fresh ledger keeps trading with finite fills.
    data.setQuote('600519.SH', 10, now.current.toISOString())
    await service.place({ symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
    const after = await service.trades()
    assert.equal(after.length, 1)
    assert.ok(Number.isFinite(after[0].qty))

    // Restart on the rewritten ledger: no lock, clean replay.
    now.current = at('2026-10-21', '11:00')
    const restarted = makeService(home, data, now)
    const reloaded = await restarted.service.account()
    assert.equal(reloaded.blocked, false)
    assert.equal(reloaded.positions.length, 1)
    assert.equal(reloaded.cash, 98_994.99)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('p1-1: prevClose is recovered from daily bars so price limits apply', async () => {
  const home = makeHome('prev-close')
  const data = makeData()
  const now = { current: at('2026-10-22', '10:00') }
  data.setBars('600519.SH', [
    bar('2026-10-20', 11.2),
    bar('2026-10-21', 11.28),
    bar('2026-10-22', 11.3),
  ])
  data.setQuote('600519.SH', 11.28, now.current.toISOString())
  const { service } = makeService(home, data, now)
  try {
    const preview = await service.preview({ symbol: '600519.SH', side: 'buy', type: 'limit', qty: 100, limitPrice: 10 })
    assert.ok(preview.priceLimit, 'preview must know the price limit')
    assert.equal(preview.priceLimit.lower, 10.15)
    assert.ok(preview.warnings.some(warning => /涨跌停/.test(warning)), preview.warnings.join('；'))

    const rejected = await service.place({ symbol: '600519.SH', side: 'buy', type: 'limit', qty: 100, limitPrice: 10 })
    assert.equal(rejected.status, 'rejected')
    assert.match(rejected.reason ?? '', /PRICE_LIMIT/)

    const accepted = await service.place({ symbol: '600519.SH', side: 'buy', type: 'limit', qty: 100, limitPrice: 10.3 })
    assert.equal(accepted.status, 'pending')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
