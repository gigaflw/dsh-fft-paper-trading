#!/usr/bin/env node
/**
 * 离线断言：撮合模型（M2）。不启应用、不碰 ~/.dsh。
 *
 *   node tests/e2e/offline-matching.mjs
 *
 * 断言的就是这轮定下的规则：成交价=最新价、无滑点、无成交量上限、无行情 TTL；
 * 限价未穿越挂单、穿越即全成；旧版本账本锁户，不再尝试迁移。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccountRepo, PaperService, WeekdayTradingCalendar } from '../../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const home = join(root, 'build', 'e2e-offline-matching')
const failures = []
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

await rm(home, { recursive: true, force: true })
await mkdir(join(home, 'paper-trading', 'default'), { recursive: true })

let last = 11.29
let marketTs = '2026-10-22T02:00:00.000Z'
const data = {
  quotes: async symbols => ({
    state: 'ok',
    quotes: symbols.map(symbol => ({
      symbol, last, prevClose: 11.2, marketTs, fetchedAt: new Date().toISOString(), source: 'fake',
    })),
  }),
  dailyBars: async () => ({ state: 'ok', bars: [] }),
  minuteBars: async () => { throw new Error('M2 不应请求分钟成交量') },
  search: async () => [],
  marketList: async () => ({ quotes: [], page: 1, pageSize: 50, total: 0 }),
}
const now = () => new Date('2026-10-22T10:00:00+08:00')
const repo = new AccountRepo({ home, accountId: 'default' })
const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now })

const market = await service.place({ symbol: '000001', side: 'buy', type: 'market', qty: 100 }, 'm1')
assert('市价单立即全成', market.status === 'filled' && market.filledQty === 100)
assert('成交价=最新价', market.fillPrice === 11.29, `price=${market.fillPrice}`)

const restPreview = await service.preview({ symbol: '000001', side: 'buy', type: 'limit', qty: 100, limitPrice: 10.5 })
assert('限价未穿越按限价计价', restPreview.price === 10.5, `price=${restPreview.price}`)
assert('限价未穿越有挂单提示', restPreview.warnings.some(w => /挂单等待/.test(w)))
const resting = await service.place({ symbol: '000001', side: 'buy', type: 'limit', qty: 100, limitPrice: 10.5 }, 'm2')
assert('未穿越的单进挂单', resting.status === 'pending', `status=${resting.status}`)
await service.tick()
assert('价格未到不动', (await service.orders()).find(o => o.id === resting.id).status === 'pending')
last = 10.49
await service.tick()
const filled = (await service.orders()).find(o => o.id === resting.id)
assert('穿越后按最新价成交', filled.status === 'filled' && filled.fillPrice === 10.49, `price=${filled.fillPrice}`)

last = 11.29
const crossedPreview = await service.preview({ symbol: '000001', side: 'buy', type: 'limit', qty: 100, limitPrice: 11.4 })
assert('穿越时限价预览=最新价', crossedPreview.price === 11.29, `price=${crossedPreview.price}`)
const crossed = await service.place({ symbol: '000001', side: 'buy', type: 'limit', qty: 100, limitPrice: 11.4 }, 'm3')
assert('穿越立即成交', crossed.status === 'filled' && crossed.fillPrice === 11.29)

marketTs = '2026-10-22T00:00:00.000Z'
const stale = await service.place({ symbol: '000001', side: 'buy', type: 'market', qty: 100 }, 'm4')
assert('无行情 TTL：两小时前的报价仍成交', stale.status === 'filled' && stale.fillPrice === 11.29)

const partial = (await service.orders()).filter(order => order.status === 'partially_filled')
assert('不产生部分成交', partial.length === 0)
assert('市价单从不挂单', (await service.orders()).every(order => order.type !== 'market' || order.status !== 'pending'))

// 旧版本账本（ledgerVersion 2）不再兼容：锁户，而不是猜着迁移
const legacyHome = join(root, 'build', 'e2e-offline-matching-legacy')
await rm(legacyHome, { recursive: true, force: true })
await mkdir(join(legacyHome, 'paper-trading', 'default'), { recursive: true })
await writeFile(join(legacyHome, 'paper-trading', 'default', 'events.jsonl'), `${JSON.stringify({
  seq: 1, id: 'evt-1', ts: '2026-10-20T01:00:00.000Z', type: 'account.opened',
  payload: {
    accountId: 'default', ledgerVersion: 2, initialCashCents: 10_000_000, tradeDate: '2026-10-20',
    settings: {
      initialCashCents: 10_000_000, commissionRate: 0.00025, minCommissionCents: 500,
      stampDutyRate: 0.0005, transferFeeRate: 0.00001, enableT1: true, maxOrderNotionalCents: 0,
    },
  },
})}\n`)
const legacy = await new AccountRepo({ home: legacyHome, accountId: 'default', logger: { warn: () => {} } }).current()
assert('旧版本账本锁户', legacy.blocked === true && /不兼容/.test(legacy.blockedReason ?? ''), legacy.blockedReason)

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(' / ')}`)
process.exit(failures.length === 0 ? 0 : 1)
