import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, PAPER_LEDGER_VERSION } from '../lib/contract.js'
import { DEFAULT_FUTURES_SETTINGS, FUTURES_ACCOUNT_ID } from '../lib/futures-contract.js'
import { AccountRepo } from '../lib/store/repo.js'
import { FuturesRepo } from '../lib/store/futures-repo.js'
import { backupsDir, eventsPath } from '../lib/store/paths.js'
import { registerLedgerTools } from '../lib/agent/ledger-tools.js'
import { PaperService } from '../lib/service/paper-service.js'
import { FuturesService } from '../lib/service/futures-service.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'

const at = '2026-10-20T02:00:00.000Z'
const homeOf = name => join(process.cwd(), 'build', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)

function stockOpened(version = PAPER_LEDGER_VERSION, settings = DEFAULT_SETTINGS) {
  return {
    seq: 1,
    id: 'evt-1',
    ts: at,
    type: 'account.opened',
    payload: { accountId: 'default', settings, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: version },
  }
}

function futuresOpened() {
  return {
    seq: 1,
    id: 'evt-1',
    ts: at,
    type: 'account.opened',
    payload: { accountId: FUTURES_ACCOUNT_ID, settings: DEFAULT_FUTURES_SETTINGS, initialCashCents: DEFAULT_FUTURES_SETTINGS.initialCashCents, tradeDate: '2026-10-20' },
  }
}

async function writeLedger(home, accountId, events) {
  const file = eventsPath(home, accountId)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${events.map(event => JSON.stringify(event)).join('\n')}\n`, 'utf8')
  return file
}

async function appendEvent(home, accountId, event) {
  const file = eventsPath(home, accountId)
  await writeFile(file, `${(await readFile(file, 'utf8')).trim()}\n${JSON.stringify(event)}\n`, 'utf8')
  return file
}

async function backups(home, accountId) {
  try {
    return await readdir(backupsDir(home, accountId))
  } catch {
    return []
  }
}

const service = (repo, now = new Date('2026-10-20T10:00:00+08:00')) => new PaperService({
  repo,
  data: {
    quotes: async () => ({ state: 'failed', quotes: [], notice: 'no quote' }),
    dailyBars: async () => ({ state: 'ok', bars: [] }),
    minuteBars: async () => ({ state: 'ok', bars: [] }),
    search: async () => [],
    marketList: async () => ({ state: 'ok', quotes: [], page: 1, pageSize: 50 }),
  },
  calendar: new WeekdayTradingCalendar(),
  now: () => now,
})

test('recovery: a load leaves a daily automatic snapshot and does not duplicate it', async () => {
  const home = homeOf('auto-snapshot')
  await writeLedger(home, 'default', [stockOpened()])
  try {
    await new AccountRepo({ home, accountId: 'default' }).current()
    const first = (await backups(home, 'default')).filter(name => name.startsWith('events-auto-'))
    assert.equal(first.length, 1, 'the first successful load writes one automatic snapshot')

    await new AccountRepo({ home, accountId: 'default' }).current()
    await new AccountRepo({ home, accountId: 'default' }).current()
    const later = (await backups(home, 'default')).filter(name => name.startsWith('events-auto-'))
    assert.equal(later.length, 1, 'a snapshot younger than 24h is not replaced')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: a v3 ledger is migrated instead of locking the account', async () => {
  const home = homeOf('migrate-v3')
  const v3 = [
    {
      seq: 1,
      id: 'evt-1',
      ts: at,
      type: 'account.opened',
      payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: 3 },
    },
    {
      seq: 2,
      id: 'evt-2',
      ts: at,
      type: 'order.submitted',
      payload: {
        order: {
          id: 'ord-1', requestId: 'r1', symbol: '600519', side: 'buy', type: 'market', qty: 100,
          status: 'pending', createdAt: at, updatedAt: at, filledQty: 0, remainingQty: 100, tradeDate: '2026-10-20',
        },
        quote: { symbol: '600519', last: 10, marketTs: at, fetchedAt: at },
      },
    },
    {
      seq: 3,
      id: 'evt-3',
      ts: at,
      type: 'order.filled',
      payload: {
        orderId: 'ord-1',
        fill: {
          id: 'fill-1', orderId: 'ord-1', symbol: '600519', side: 'buy', price: 10, qty: 100,
          amountCents: 100_000, fees: { commissionCents: 0, stampCents: 0, transferCents: 0, totalCents: 0 },
          ts: at, tradeDate: '2026-10-20',
        },
      },
    },
    {
      seq: 4,
      id: 'evt-4',
      ts: at,
      type: 'day.closed',
      payload: {
        date: '2026-10-20', equityCents: 9_900_000, cashCents: 9_900_000, nextDate: '2026-10-21',
        closePrices: { '600519': 10 }, gaps: { '600519': 0 },
        positions: [{ symbol: '600519', qty: 100, available: 0, costCents: 100_000 }],
      },
    },
  ]
  const file = await writeLedger(home, 'default', v3)
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    const state = await repo.current()
    assert.equal(state.blocked, false, state.blockedReason ?? '')
    assert.equal(state.ledgerVersion, PAPER_LEDGER_VERSION)
    assert.ok(state.positions['600519.SH'], 'the fill identity is canonical after migration')

    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(lines[0].payload.ledgerVersion, PAPER_LEDGER_VERSION)
    assert.ok(lines.some(line => line.type === 'ledger.migrated'), 'migration leaves an audit marker')
    assert.doesNotMatch(await readFile(file, 'utf8'), /"symbol":"\d{6}"/, 'no raw symbol survives')

    const names = await backups(home, 'default')
    assert.ok(names.some(name => name.startsWith('events-pre-migrate-')), 'the pre-migration ledger is kept')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: restoring the newest snapshot unblocks a corrupted account', async () => {
  const home = homeOf('restore-stock')
  const file = await writeLedger(home, 'default', [stockOpened()])
  try {
    const first = new AccountRepo({ home, accountId: 'default' })
    assert.equal((await first.current()).blocked, false)
    const auto = (await backups(home, 'default')).find(name => name.startsWith('events-auto-'))
    assert.ok(auto, 'a snapshot exists before the corruption')

    await appendEvent(home, 'default', {
      seq: 2, id: 'evt-2', ts: at, type: 'order.filled',
      payload: {
        orderId: 'ord-x',
        fill: {
          id: 'fill-x', orderId: 'ord-x', symbol: '600519.SH', side: 'buy', price: 10, qty: null,
          amountCents: null, fees: { commissionCents: 0, stampCents: 0, transferCents: 0, totalCents: 0 },
          ts: at, tradeDate: '2026-10-20',
        },
      },
    })

    const broken = new AccountRepo({ home, accountId: 'default' })
    assert.equal((await broken.current()).blocked, true)

    const listed = await broken.snapshots()
    const usable = listed.filter(snapshot => snapshot.valid)
    assert.ok(usable.length >= 1, 'the automatic snapshot still replays cleanly')
    assert.equal(usable[0].name, auto)

    const restored = await broken.restore(auto)
    assert.equal(restored.blocked, false)
    assert.equal(restored.cashCents, 10_000_000)
    assert.equal(restored.lastSeq, 1)

    const live = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(live.length, 1, 'the live ledger is the restored snapshot only')
    assert.ok((await backups(home, 'default')).some(name => name.startsWith('events-pre-restore-')), 'the corrupted file is kept for forensics')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: restoring an older-version snapshot migrates it instead of locking', async () => {
  const home = homeOf('restore-v3')
  await writeLedger(home, 'default', [stockOpened()])
  const v3Snapshot = [
    {
      seq: 1,
      id: 'evt-1',
      ts: at,
      type: 'account.opened',
      payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-18', ledgerVersion: 3 },
    },
    {
      seq: 2,
      id: 'evt-2',
      ts: at,
      type: 'order.submitted',
      payload: {
        order: {
          id: 'ord-1', requestId: 'r1', symbol: '600519', side: 'buy', type: 'market', qty: 100,
          status: 'pending', createdAt: at, updatedAt: at, filledQty: 0, remainingQty: 100, tradeDate: '2026-10-18',
        },
        quote: { symbol: '600519', last: 10, marketTs: at, fetchedAt: at },
      },
    },
  ]
  await mkdir(backupsDir(home, 'default'), { recursive: true })
  await writeFile(
    join(backupsDir(home, 'default'), 'events-auto-v3.jsonl'),
    `${v3Snapshot.map(event => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  )
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    await repo.current()
    const listed = await repo.snapshots()
    const candidate = listed.find(snapshot => snapshot.name === 'events-auto-v3.jsonl')
    assert.equal(candidate?.valid, true)
    assert.equal(candidate?.migratable, true)

    const restored = await repo.restore('events-auto-v3.jsonl')
    assert.equal(restored.blocked, false)
    assert.equal(restored.ledgerVersion, PAPER_LEDGER_VERSION)
    assert.equal(restored.tradeDate, '2026-10-18')
    const live = (await readFile(eventsPath(home, 'default'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(live[0].payload.ledgerVersion, PAPER_LEDGER_VERSION)
    assert.ok(live.some(event => event.type === 'ledger.migrated'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: a snapshot that does not replay is listed but refused', async () => {
  const home = homeOf('restore-invalid')
  await writeLedger(home, 'default', [stockOpened()])
  const snapshot = join(backupsDir(home, 'default'), 'events-auto-bad.jsonl')
  await mkdir(dirname(snapshot), { recursive: true })
  await writeFile(snapshot, `${JSON.stringify({
    seq: 1, id: 'evt-1', ts: at, type: 'account.opened',
    payload: { accountId: 'default', settings: DEFAULT_SETTINGS, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: PAPER_LEDGER_VERSION },
  })}\n${JSON.stringify({
    seq: 2, id: 'evt-2', ts: at, type: 'order.filled',
    payload: {
      orderId: 'ord-x',
      fill: {
        id: 'fill-x', orderId: 'ord-x', symbol: '600519.SH', side: 'buy', price: 10, qty: null,
        amountCents: null, fees: { commissionCents: 0, stampCents: 0, transferCents: 0, totalCents: 0 },
        ts: at, tradeDate: '2026-10-20',
      },
    },
  })}\n`, 'utf8')
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    const listed = await repo.snapshots()
    const bad = listed.find(snapshot => snapshot.name === 'events-auto-bad.jsonl')
    assert.equal(bad?.valid, false)
    assert.ok(bad?.problem)
    await assert.rejects(repo.restore('events-auto-bad.jsonl'), /对账失败|结构损坏/)
    await assert.rejects(repo.restore('../events.jsonl'), /不是合法的账本快照名/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: a ledger from a newer plugin cannot be restored into this build', async () => {
  const home = homeOf('restore-newer')
  await writeLedger(home, 'default', [stockOpened(PAPER_LEDGER_VERSION + 1)])
  const snapshot = await writeLedger(home, 'default', [stockOpened(PAPER_LEDGER_VERSION + 1)])
  await mkdir(backupsDir(home, 'default'), { recursive: true })
  await writeFile(join(backupsDir(home, 'default'), 'events-auto-newer.jsonl'), await readFile(snapshot, 'utf8'), 'utf8')
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    const state = await repo.current()
    assert.equal(state.blocked, true)
    assert.match(state.blockedReason ?? '', /高于|不兼容/)
    const listed = await repo.snapshots()
    assert.equal(listed.find(item => item.name === 'events-auto-newer.jsonl')?.valid, false)
    await assert.rejects(repo.restore('events-auto-newer.jsonl'), /高于|对账失败|无法恢复|结构损坏/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: the futures ledger shares the same snapshot and restore path', async () => {
  const home = homeOf('restore-futures')
  const file = await writeLedger(home, FUTURES_ACCOUNT_ID, [futuresOpened()])
  try {
    const first = new FuturesRepo({ home })
    assert.equal((await first.current()).blocked, false)
    const auto = (await backups(home, FUTURES_ACCOUNT_ID)).find(name => name.startsWith('events-auto-'))
    assert.ok(auto)

    await appendEvent(home, FUTURES_ACCOUNT_ID, {
      seq: 2, id: 'evt-2', ts: at, type: 'ledger.violation',
      payload: { check: 'test', expected: 'consistent', actual: '人为写入的损坏' },
    })
    const broken = new FuturesRepo({ home })
    assert.equal((await broken.current()).blocked, true)

    const listed = await broken.snapshots()
    assert.equal(listed.filter(snapshot => snapshot.valid).length, 1)
    const restored = await broken.restore(auto)
    assert.equal(restored.blocked, false)
    assert.equal(restored.lastSeq, 1)
    const live = (await readFile(file, 'utf8')).trim().split('\n')
    assert.equal(live.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery: paper_ledger lists snapshots and restores one for the agent', async () => {
  const home = homeOf('tool')
  await writeLedger(home, 'default', [stockOpened()])
  try {
    const repo = new AccountRepo({ home, accountId: 'default' })
    const stock = service(repo)
    const futures = new FuturesService({
      repo: new FuturesRepo({ home }),
      data: {
        contracts: async () => ({ state: 'ok', contracts: [] }),
        quotes: async () => ({ state: 'failed', quotes: [], notice: 'no quote' }),
        limits: async () => ({ state: 'failed', limits: [], notice: 'no quote' }),
        settle: async () => ({ state: 'failed', settles: [], notice: 'no quote' }),
        closes: async () => ({ state: 'failed', closes: [], notice: 'no quote' }),
      },
      calendar: new WeekdayTradingCalendar(),
      now: () => new Date('2026-10-20T10:00:00+08:00'),
    })
    const registered = new Map()
    registerLedgerTools({ register: tool => registered.set(tool.name, tool) }, { stock, futures })
    const tool = registered.get('paper_ledger')
    assert.ok(tool, 'paper_ledger is registered once for both accounts')

    await repo.current()
    const listed = await tool.execute({ action: 'list' })
    assert.match(listed.summary, /快照 \d+ 份（可恢复 \d+ 份）/)
    const name = (await repo.snapshots()).find(snapshot => snapshot.valid)?.name
    assert.ok(name)
    const restored = await tool.execute({ action: 'restore', name, confirm: true })
    assert.match(restored.summary, new RegExp(`已恢复 ${name.replaceAll('.', '\\.')}`))
    const missing = await tool.execute({ action: 'restore', name, confirm: false })
    assert.match(missing.summary, /confirm=true/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
