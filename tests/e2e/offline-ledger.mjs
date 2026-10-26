#!/usr/bin/env node
/**
 * 离线断言：账本层（不启应用、不碰 ~/.dsh）。
 *
 *   node tests/e2e/offline-ledger.mjs
 *
 * 覆盖这轮排查里真踩到的几件事：
 *   1. 重复 seq（并发读多写一遍）会被载入时去重修复；
 *   2. 旧版本账本不再兼容，直接锁户并要求重置；
 *   3. 000001 在账本里只以 000001.SZ 存在，指数订单被拒；
 *   4. NaN 成交会让账本判非法并锁定，但「重置」能把账本原子重写成单条 genesis。
 * 数据全部写入 build/，退出码 0=全过。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccountRepo, PAPER_LEDGER_VERSION, PaperService, WeekdayTradingCalendar } from '../../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const home = join(root, 'build', 'e2e-offline-ledger')
const oldHome = join(root, 'build', 'e2e-offline-ledger-old')
const ledgerPath = join(home, 'paper-trading', 'default', 'events.jsonl')
const oldLedgerPath = join(oldHome, 'paper-trading', 'default', 'events.jsonl')

const failures = []
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const settings = {
  initialCashCents: 10_000_000, commissionRate: 0.00025, minCommissionCents: 500,
  stampDutyRate: 0.0005, transferFeeRate: 0.00001,
  enableT1: true, maxOrderNotionalCents: 0,
}
const ev = (seq, ts, type, payload) => ({ seq, id: `evt-${seq}`, ts, type, payload })
const repeated = (event, times) => Array.from({ length: times }, () => event)

// 1. 当前版本账本 + 重复事件
const current = [
  ev(1, '2026-10-20T01:00:00.000Z', 'account.opened', {
    accountId: 'default', settings, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: PAPER_LEDGER_VERSION,
  }),
  ...repeated(ev(2, '2026-10-20T07:00:00.000Z', 'day.closed', {
    date: '2026-10-20', equityCents: 10_000_000, cashCents: 10_000_000, nextDate: '2026-10-21',
    recordedAt: '2026-10-21T00:00:00.000Z',
  }), 3),
  ...repeated(ev(3, '2026-10-21T01:15:00.000Z', 'day.pre_opened', {
    date: '2026-10-21', recordedAt: '2026-10-21T01:20:00.000Z',
  }), 2),
]
await rm(home, { recursive: true, force: true })
await mkdir(join(home, 'paper-trading', 'default'), { recursive: true })
await writeFile(ledgerPath, `${current.map(e => JSON.stringify(e)).join('\n')}\n`)

const repo = new AccountRepo({ home, accountId: 'default' })
const repaired = await repo.current()
assert('重复 seq 不再锁户', repaired.blocked === false)
const lines = (await readFile(ledgerPath, 'utf8')).trim().split('\n')
assert('账本被压缩', lines.length === 4, `lines=${lines.length}（3 条唯一事件 + repaired 标记）`)
assert('写了一条修复标记', lines.some(line => line.includes('ledger.repaired')))

// 2. 当前账本能成交，且 000001 落库为 000001.SZ
const now = new Date('2026-10-21T10:00:00+08:00')
const data = {
  quotes: async symbols => ({
    state: 'ok',
    quotes: symbols.map(symbol => ({
      symbol, name: '平安银行', last: 11.44, prevClose: 11.4,
      marketTs: now.toISOString(), fetchedAt: now.toISOString(), source: 'fake',
    })),
  }),
  dailyBars: async () => ({
    state: 'ok',
    bars: [{ time: '2026-10-20T15:00:00+08:00', open: 11.2, high: 11.5, low: 11.1, close: 11.4, volume: 900000 }],
  }),
  minuteBars: async () => ({ state: 'ok', bars: [] }),
  search: async () => [],
  marketList: async () => ({ quotes: [], page: 1, pageSize: 50, total: 0 }),
}
const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
const order = await service.place({ symbol: '000001', side: 'buy', type: 'market', qty: 100 }, 'e2e-1')
const account = await service.account()
assert('账本能成交', order.status === 'filled', `status=${order.status}`)
assert('订单存 canonical id', order.symbol === '000001.SZ', `symbol=${order.symbol}`)
assert('持仓键为 canonical id', account.positions[0]?.symbol === '000001.SZ', JSON.stringify(account.positions))
assert('成交数量有限', order.filledQty === 100 && Number.isFinite(account.cash), `qty=${order.filledQty} cash=${account.cash}`)

let rejectedIndex = null
try {
  await service.place({ symbol: '000001.SH', side: 'buy', type: 'market', qty: 100 })
} catch (error) {
  rejectedIndex = error
}
assert('上证指数不可交易', rejectedIndex?.code === 'UNSUPPORTED_INSTRUMENT', String(rejectedIndex))

// 3. NaN 成交 → 锁定 → 重置 → 可重放
const nanFill = ev(99, '2026-10-21T02:00:00.000Z', 'order.partially_filled', {
  orderId: 'ord-old',
  fill: {
    id: 'fill-old', orderId: 'ord-old', symbol: '000001.SZ', side: 'buy', price: 11.44, qty: null,
    amountCents: null, fees: { commissionCents: 0, stampCents: 0, transferCents: 0, totalCents: 0 },
    ts: '2026-10-21T02:00:00.000Z', tradeDate: '2026-10-21',
  },
})
await writeFile(ledgerPath, `${(await readFile(ledgerPath, 'utf8')).trim()}\n${JSON.stringify(nanFill)}\n`)
const poisoned = new AccountRepo({ home, accountId: 'default', logger: { warn: () => {} } })
assert('NaN 成交会锁户而不是静默修复', (await poisoned.current()).blocked === true)

const recovered = await new PaperService({ repo: poisoned, data, calendar: new WeekdayTradingCalendar(), now: () => now }).reset(true)
assert('锁户也能重置', recovered.blocked === false && recovered.cash === 100000)
const replay = await new AccountRepo({ home, accountId: 'default' }).current()
assert('重置后重放干净', replay.blocked === false && replay.lastSeq === 1, `lastSeq=${replay.lastSeq}`)

// 4. 导出
const exported = await service.exportLedger()
assert('账本可导出', exported.exists === true && exported.content.includes('account.reset'))

// 5. 旧版本账本不兼容
await rm(oldHome, { recursive: true, force: true })
await mkdir(join(oldHome, 'paper-trading', 'default'), { recursive: true })
await writeFile(oldLedgerPath, `${JSON.stringify(ev(1, '2026-10-20T01:00:00.000Z', 'account.opened', {
  accountId: 'default', settings, initialCashCents: 10_000_000, tradeDate: '2026-10-20', ledgerVersion: 3,
}))}\n`)
const oldRepo = new AccountRepo({ home: oldHome, accountId: 'default', logger: { warn: () => {} } })
const oldState = await oldRepo.current()
assert('旧版本账本锁户', oldState.blocked === true && /不兼容/.test(oldState.blockedReason ?? ''), oldState.blockedReason)
const oldService = new PaperService({ repo: oldRepo, data, calendar: new WeekdayTradingCalendar(), now: () => now })
const oldReset = await oldService.reset(true)
assert('旧账本可一键重置', oldReset.blocked === false && oldReset.cash === 100000)

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(' / ')}`)
process.exit(failures.length === 0 ? 0 : 1)
