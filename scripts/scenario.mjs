import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'

const DAY1 = new Date('2026-10-19T02:00:00.000Z')
const DAY2 = new Date('2026-10-20T02:00:00.000Z')

const prices = new Map()
const data = {
  async quotes(symbols) {
    const rows = symbols.map(symbol => prices.get(symbol)).filter(Boolean)
    return rows.length > 0 ? { state: 'ok', quotes: rows } : { state: 'failed', quotes: [], notice: 'no quote' }
  },
  async dailyBars() {
    return { state: 'ok', bars: [] }
  },
}

const home = join(process.cwd(), 'tmp', 'paper-trading-scenario', String(Date.now()))
let now = DAY1
const repo = new AccountRepo({ home, accountId: 'default' })
const service = new PaperService({ repo, data, now: () => now })

try {
  console.log('账户', await service.account())
  prices.set('600519', { symbol: '600519', name: '贵州茅台', last: 10, bid: 9.99, ask: 10, ts: DAY1.toISOString() })
  console.log('买入', await service.place({ symbol: '600519', side: 'buy', type: 'market', qty: 100 }))
  console.log('当日卖出被拒', await service.place({ symbol: '600519', side: 'sell', type: 'market', qty: 100 }))

  now = DAY2
  prices.set('600519', { symbol: '600519', name: '贵州茅台', last: 10.2, bid: 10.19, ask: 10.2, ts: DAY2.toISOString() })
  console.log('次日刷新', await service.tick())
  console.log('次日卖出', await service.place({ symbol: '600519', side: 'sell', type: 'market', qty: 100 }))
  console.log('复盘', await service.review('all'))
} finally {
  await rm(home, { recursive: true, force: true })
}
