#!/usr/bin/env node
/**
 * 假数据后端：把面板的 RPC 指向一个「假时钟 + 假行情」的 PaperService。
 *
 * 为什么不用 CDP 拦请求：面板的 fetch 走宿主注册的 route，不在网络栈上，
 * Fetch domain 拦不到。做法是在页面里把 window.fetch 改成转发到本进程的
 * /rpc（见 flow-fake.mjs），本进程随后用 lib/ 里的真服务跑账本。
 *
 * 用法：
 *   node tests/e2e/fake-backend.mjs [--port 4599] [--home tmp/e2e-home]
 *                                   [--clock 2026-10-22T09:31:00+08:00]
 * 控制口：
 *   GET  /state          账户/持仓/订单/成交快照
 *   POST /clock  {iso}   设时钟（{"iso":"2026-10-23T09:31:00+08:00"}）
 *   POST /quote  {symbol,last,prevClose}
 *   POST /rpc    {endpoint,payload}   ← 面板的请求转到这里
 */
import http from 'node:http'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AccountRepo, PaperService, WeekdayTradingCalendar, createPaperRpcHandler,
} from '../../lib/index.js'
import { tryParseSymbol } from '../../lib/core/symbol.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

function take(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

export async function startFakeBackend({
  port = Number(take('port', process.env.PT_FAKE_PORT ?? 4599)),
  home = take('home', join(repoRoot, 'tmp', 'e2e-home')),
  clock = take('clock', '2026-10-22T09:31:00+08:00'),
} = {}) {
  await rm(home, { recursive: true, force: true })
  await mkdir(join(home, 'paper-trading', 'default'), { recursive: true })

  let nowMs = Date.parse(clock)
  const now = () => new Date(nowMs)

  // 两只票足够走完流程：一贵一便宜，价格/涨跌停基准都可控。
  const canonical = symbol => {
    const parsed = tryParseSymbol(String(symbol ?? ''))
    return parsed.ok ? parsed.symbol.id : String(symbol ?? '')
  }
  const quotes = new Map([
    ['000001.SZ', { symbol: '000001.SZ', name: '平安银行', last: 11.3, prevClose: 11.2 }],
    ['600519.SH', { symbol: '600519.SH', name: '贵州茅台', last: 1300, prevClose: 1290 }],
  ])
  const quoteOf = symbol => {
    const base = quotes.get(symbol) ?? { symbol, name: symbol, last: 10, prevClose: 10 }
    const ts = new Date(nowMs).toISOString()
    return { ...base, marketTs: ts, fetchedAt: ts, source: 'fake' }
  }
  const data = {
    async quotes(symbols) { return { state: 'ok', quotes: symbols.map(quoteOf) } },
    // 日 K 从当前时钟往前推 5 天：收盘结算才有「日K收盘」这个来源。
    async dailyBars() {
      const bars = []
      for (let i = 5; i >= 1; i -= 1) {
        const day = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10)
        bars.push({ time: `${day}T15:00:00+08:00`, open: 11.2, high: 11.4, low: 11.1, close: 11.2, volume: 900000 })
      }
      return { state: 'ok', bars }
    },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search(query) {
      return [...quotes.values()]
        .filter(hit => hit.symbol.includes(query) || hit.name.includes(query))
        .map(hit => ({ symbol: hit.symbol, name: hit.name }))
    },
    async marketList() {
      const ts = new Date(nowMs).toISOString()
      return {
        quotes: [...quotes.values()].map(q => ({ ...q, marketTs: ts, fetchedAt: ts })),
        page: 1, pageSize: 50, total: quotes.size,
      }
    },
  }

  const repo = new AccountRepo({ home, accountId: 'default', logger: { warn: m => console.error('[repo]', m) } })
  const service = new PaperService({ repo, data, calendar: new WeekdayTradingCalendar(), now })
  const rpc = createPaperRpcHandler(service)

  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': '*',
  }
  const json = (res, value) => {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }
  const body = req => new Promise(resolveBody => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => { try { resolveBody(raw === '' ? {} : JSON.parse(raw)) } catch { resolveBody({}) } })
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'OPTIONS') return json(res, {})
    if (req.method === 'POST' && url.pathname === '/rpc') {
      const input = await body(req)
      return json(res, await rpc(input.endpoint, input.payload, new AbortController().signal))
    }
    if (req.method === 'POST' && url.pathname === '/clock') {
      const input = await body(req)
      if (typeof input.iso === 'string') nowMs = Date.parse(input.iso)
      if (typeof input.advanceMs === 'number') nowMs += input.advanceMs
      return json(res, { now: new Date(nowMs).toISOString() })
    }
    if (req.method === 'POST' && url.pathname === '/quote') {
      const input = await body(req)
      const symbol = canonical(input.symbol)
      const current = quotes.get(symbol) ?? { symbol, name: symbol, prevClose: 11.2 }
      quotes.set(symbol, { ...current, last: Number(input.last), prevClose: Number(input.prevClose ?? current.prevClose) })
      return json(res, { quote: quotes.get(symbol) })
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      const account = await service.account()
      const orders = await service.orders()
      const trades = await service.trades()
      const review = await service.review('30d')
      return json(res, {
        now: new Date(nowMs).toISOString(),
        tradeDate: account.tradeDate,
        blocked: account.blocked,
        cash: account.cash,
        equity: account.equity,
        pnl: account.pnl,
        todayPnl: account.todayPnl,
        positions: account.positions,
        orders: orders.map(o => ({ id: o.id, status: o.status, qty: o.qty, filledQty: o.filledQty, fillPrice: o.fillPrice, limitPrice: o.limitPrice })),
        trades: trades.map(t => ({ side: t.side, qty: t.qty, price: t.price, feesCents: t.feesCents })),
        review: { tradeCount: review.tradeCount, realizedPnl: review.realizedPnl, totalFees: review.totalFees },
      })
    }
    res.writeHead(404, CORS)
    res.end('not found')
  })

  await new Promise(resolveListen => server.listen(port, '127.0.0.1', resolveListen))
  return {
    port,
    service,
    clock: () => new Date(nowMs),
    setClock: iso => { nowMs = Date.parse(iso) },
    setQuote: (symbol, last) => {
      const key = canonical(symbol)
      const current = quotes.get(key) ?? { symbol: key, name: key, prevClose: 11.2 }
      quotes.set(key, { ...current, last })
    },
    // 面板的 5 秒轮询只在窗口可见时跑；脚本用它模拟一次撮合心跳。
    tick: () => service.tick(),
    stop: () => new Promise(resolveStop => server.close(resolveStop)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backend = await startFakeBackend()
  console.log(`ready http://127.0.0.1:${backend.port} clock=${backend.clock().toISOString()}`)
  const stop = async () => { await backend.stop(); process.exit(0) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
