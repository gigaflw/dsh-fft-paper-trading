#!/usr/bin/env node
/**
 * 浏览器端端到端：真 React DOM + 真客户端 bundle + 假 RPC。
 *
 *   node tests/e2e/ui-panel.mjs
 *
 * 不启动 DSH，也不碰 ~/.dsh：把 lib/client.js 里的面板挂到一个静态页，
 * window.fetch 指向本页内的假后端，然后按用户路径点按钮、断言 DOM。
 * 覆盖：股票面板、一揽子导入→预览→下单、期货账户切换→搜合约→预览→开仓。
 *
 * 前置：`pnpm build`（本脚本直接读 lib/client.js）；react-dom UMD 需要可寻址。
 * 本机一次性准备：
 *   mkdir -p tmp/ui-deps && (cd tmp/ui-deps && npm i react@18.3.1 react-dom@18.3.1)
 * 或用 REACT_UMD_DIR 指向同时含 react.development.js / react-dom.development.js 的目录。
 */
import http from 'node:http'
import net from 'node:net'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const failures = []
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}
const findUmd = () => {
  const explicit = process.env.REACT_UMD_DIR
  if (explicit) return explicit
  const candidates = [
    join(root, 'tmp/ui-deps/node_modules'),
    join(root, 'node_modules'),
  ]
  for (const base of candidates) {
    const dir = join(base, 'react', 'umd')
    const reactDom = join(base, 'react-dom', 'umd')
    if (existsSync(join(dir, 'react.development.js')) && existsSync(join(reactDom, 'react-dom.development.js'))) {
      return { react: dir, reactDom }
    }
  }
  throw new Error('react/react-dom UMD 不可寻址：见文件头的一次性准备说明，或设置 REACT_UMD_DIR')
}
const umd = findUmd()
const chrome = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`
if (!existsSync(chrome)) throw new Error('找不到 headless Chromium：设置 CHROME 指向 chrome-headless-shell')

const freePort = async () => {
  const server = net.createServer()
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
const pagePort = await freePort()
const cdpPort = await freePort()
const profile = mkdtempSync(join(root, 'tmp', 'e2e-ui-'))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname === '/' ? 'tests/e2e/ui-panel.html' : url.pathname.replace(/^\//, '')
  const file = path === 'tests/e2e/ui-panel.html'
    ? join(root, 'tests/e2e/ui-panel.html')
    : path.startsWith('__react/react-dom')
      ? join(umd.reactDom, path.slice('__react/'.length))
      : path.startsWith('__react/')
        ? join(umd.react, path.slice('__react/'.length))
        : join(root, path)
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
})
await new Promise(done => server.listen(pagePort, '127.0.0.1', done))

const child = spawn(chrome, [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,1100',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${pagePort}/`,
], { stdio: 'ignore' })

let socket
const cleanup = async () => {
  try { if (socket) { socket.close() } } catch {}
  child.kill('SIGKILL')
  server.close()
  rmSync(profile, { recursive: true, force: true })
}
const waitFor = async (probe, timeout = 15000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try { const value = await probe(); if (value) return value } catch {}
    await new Promise(done => setTimeout(done, 150))
  }
  throw new Error('timeout')
}

try {
  const page = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    return list.find(target => target.type === 'page' && target.url.startsWith(`http://127.0.0.1:${pagePort}`))
  })
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, fail) => { socket.addEventListener('open', done); socket.addEventListener('error', fail) })
  let seq = 0
  const pending = new Map()
  const consoleLines = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    if (message.method === 'Runtime.consoleAPICalled') consoleLines.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '))
    if (message.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION ' + (message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text))
  })
  const send = (method, params = {}) => new Promise(done => {
    const id = ++seq
    pending.set(id, done)
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  const shotsDir = process.env.UI_SHOTS ?? ''
  if (shotsDir !== '') mkdirSync(shotsDir, { recursive: true })
  const shot = async name => {
    if (shotsDir === '') return
    await evaluate("document.querySelector('.pt-root')?.scrollTo(0, 0)")
    const result = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shotsDir, name), Buffer.from(result.result.data, 'base64'))
    console.log(`SHOT  ${join(shotsDir, name)}`)
  }
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text)
    return result.result?.result?.value
  }
  const scenario = async name => {
    const value = await Promise.race([
      evaluate(`window.__scenario(${JSON.stringify(name)})`),
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 20000)),
    ])
    assert(`scenario ${name} does not hang`, !(value && value.timeout))
    return value ?? {}
  }

  await waitFor(() => evaluate('window.__ready === true'))
  assert('panel mounts', await evaluate("Boolean(document.querySelector('.pt-root'))"))

  // 1. 股票面板
  const stock = await scenario('stock')
  assert('stock tabs include basket', Array.isArray(stock.tabs) && ['交易', '一揽子', '行情', '复盘'].every(label => stock.tabs.some(tab => tab.startsWith(label))), JSON.stringify(stock.tabs))
  assert('stock stats render', Array.isArray(stock.stats) && stock.stats.length === 4, JSON.stringify(stock.stats))
  assert('stock ticket keeps the aligned form grid', stock.ticketFields?.length === 7, JSON.stringify(stock.ticketFields))
  assert('stock K-line rail renders', stock.kline === true)
  assert('stock book renders', typeof stock.book === 'string' && stock.book.includes('持仓'))
  assert('short symbol keeps the panel mounted', stock.shortSymbolAlive === true, stock.shortSymbolHint ?? '')
  assert('short symbol clears the previous candles', typeof stock.shortKline === 'string' && stock.shortKline.includes('暂无 K 线数据'), stock.shortKline ?? '')
  assert('limit draft keeps the quote', typeof stock.limitQuote === 'string' && stock.limitQuote.includes('现价'), stock.limitQuote ?? '')
  assert('limit draft blocks an empty price', stock.limitSubmitDisabled === true)
  await shot('stock-trade.png')

  // 2. 一揽子
  const basketPreview = await scenario('basket-preview')
  assert('basket preview is shown before confirmation', typeof basketPreview.preview === 'string' && basketPreview.preview.includes('目标权重'), basketPreview.preview ?? '')
  await shot('basket-preview.png')
  const reviewData = await scenario('review-data')
  assert('review renders stats, chart and all four tables', Array.isArray(reviewData.stats) && reviewData.stats.some(text => text.includes('成交笔数')) && reviewData.chart === true && Array.isArray(reviewData.tables) && reviewData.tables.filter(count => count > 0).length >= 4, JSON.stringify(reviewData))
  assert('a long trade list says it is truncated', typeof reviewData.truncation === 'string' && reviewData.truncation.includes('31'), JSON.stringify(reviewData.truncation))
  assert('review marks losses with the down tone', Array.isArray(reviewData.negative) && reviewData.negative.some(text => text.includes('-1,234.56')), JSON.stringify(reviewData.negative))
  const marketRetry = await scenario('market-retry')
  assert('market failure is visible and 刷新 retries it', typeof marketRetry.error === 'string' && marketRetry.rows === 2 && marketRetry.errorAfter === null, JSON.stringify(marketRetry))
  const marketWatch = await scenario('market-watch')
  assert('market list renders and next is disabled on a short page', marketWatch.rows === 2 && marketWatch.nextDisabled === true, JSON.stringify(marketWatch))
  assert('watchlist adds and filters the market list', Array.isArray(marketWatch.added) && marketWatch.added.length === 1 && marketWatch.filteredRows === 1, JSON.stringify(marketWatch))
  assert('watchlist removes again', Array.isArray(marketWatch.removed) && marketWatch.removed.length === 0, JSON.stringify(marketWatch))
  const watchConcurrent = await scenario('watch-concurrent')
  assert('two quick star clicks keep both favourites', Array.isArray(watchConcurrent.symbols) && watchConcurrent.symbols.length === 2, JSON.stringify(watchConcurrent))
  const searchRace = await scenario('search-race')
  assert('a slower search cannot overwrite the newer results', typeof searchRace.hits === 'string' && searchRace.hits.includes('平安银行') && !searchRace.hits.includes('贵州茅台'), JSON.stringify(searchRace))
  const marketEmpty = await scenario('market-empty-search')
  assert('empty market search says so', marketEmpty.empty === '没有找到匹配标的', JSON.stringify(marketEmpty))
  const liveStock = await scenario('live-stock')
  assert('open ticket re-prices on the polling tick', typeof liveStock.quote === 'string' && liveStock.quote.includes('1,500.00'), JSON.stringify(liveStock))
  const barsFail = await scenario('bars-fail')
  assert('K-line data failure is shown in the card', typeof barsFail.hint === 'string', JSON.stringify(barsFail))
  const barsRace = await scenario('bars-race')
  assert('a stale daily-bar response cannot blank the minute chart', barsRace.chart === true, JSON.stringify(barsRace))
  const quoteRetry = await scenario('quote-retry')
  assert('failed quote is visible and refresh recovers it', typeof quoteRetry.error === 'string' && typeof quoteRetry.quote === 'string' && quoteRetry.quote.includes('现价'), JSON.stringify(quoteRetry))
  const stockClose = await scenario('stock-close')
  assert('T+1-locked position explains the disabled sell', stockClose.t1Disabled === true && typeof stockClose.t1Title === 'string' && stockClose.t1Title.includes('T+1'), JSON.stringify(stockClose))
  assert('selling a position fills and submits the ticket', stockClose.side === '卖出' && stockClose.qty === '100' && stockClose.submitLabel === '卖出' && typeof stockClose.receipt === 'string' && stockClose.receipt.includes('卖出'), JSON.stringify(stockClose))
  const basket = await scenario('basket')
  assert('basket preview has three rows', typeof basket.preview === 'string' && ['600519', '000001', '300750'].every(code => basket.preview.includes(code)), basket.preview ?? '')
  assert('basket preview shows statuses', typeof basket.preview === 'string' && basket.preview.includes('可买') && basket.preview.includes('不足 1 手'))
  assert('basket confirm is enabled', basket.confirmDisabled === false)
  assert('basket result has two fills', typeof basket.result === 'string' && basket.result.split('|').filter(part => part.includes('\t成交\t')).length === 2, basket.result ?? '')
  assert('basket cash line renders', typeof basket.cashLine === 'string' && basket.cashLine.includes('成交后现金'), basket.cashLine ?? '')
  assert('a double confirm click sends one request', Array.isArray(basket.firstBatchIds) && basket.firstBatchIds.length === 1, JSON.stringify(basket.firstBatchIds))
  assert('basket retry reuses the same batch id', Array.isArray(basket.batchIds) && basket.batchIds.length === 2 && basket.batchIds[0] === basket.batchIds[1], JSON.stringify(basket.batchIds))
  const basketCalls = await evaluate('window.__calls.filter(item => item.startsWith("basket/"))')
  assert('basket RPCs were called', basketCalls.includes('basket/preview') && basketCalls.includes('basket/place'), JSON.stringify(basketCalls))
  await shot('basket-result.png')
  const basketError = await scenario('basket-error')
  assert('basket structural errors show the host reason', typeof basketError.error === 'string' && basketError.error.includes('最多 20 只'), JSON.stringify(basketError))
  assert('basket error keeps the panel mounted', basketError.panelAlive === true)

  // 3. 期货
  const basketRace = await scenario('basket-race')
  assert('a stale basket preview is discarded after a new file', basketRace.rows === 0 && basketRace.filename === true, JSON.stringify(basketRace))
  const switched = await scenario('futures-switch')
  assert('futures switch renders the account', typeof switched.head === 'string' && switched.head.includes('期货 ·'), switched.head ?? '')
  assert('futures stats labels', Array.isArray(switched.stats) && switched.stats.some(text => text.includes('总权益')) && switched.stats.some(text => text.includes('风险度')), JSON.stringify(switched.stats))
  assert('futures has four tabs and no market tab', switched.tabs.length === 4 && !switched.tabs.some(text => text.includes('行情')), JSON.stringify(switched.tabs))
  await shot('futures-trade.png')
  const searched = await scenario('futures-search')
  assert('futures contract rail filled', typeof searched.contract === 'string' && searched.contract.includes('乘数') && searched.contract.includes('保证金率'), searched.contract ?? '')
  const previewed = await scenario('futures-preview')
  assert('futures preview shows margin and risk', typeof previewed.preview === 'string' && previewed.preview.includes('保证金') && previewed.preview.includes('风险度'), previewed.preview ?? '')
  await shot('futures-preview.png')
  const submitted = await scenario('futures-submit')
  assert('futures order fills', typeof submitted.receipt === 'string' && submitted.receipt.includes('成交'), submitted.receipt ?? '')
  assert('futures position book updates', typeof submitted.book === 'string' && submitted.book.includes('RB2611.SHFE'), submitted.book ?? '')
  await shot('futures-position.png')
  const futuresCalls = await evaluate('window.__calls.filter(item => item.startsWith("futures/"))')
  assert('futures RPCs were called', ['futures/account/get', 'futures/contracts', 'futures/preview', 'futures/order'].every(item => futuresCalls.includes(item)), JSON.stringify(futuresCalls))

  const futuresReview = await scenario('futures-review')
  assert('futures review renders without a stale variable', typeof futuresReview.body === 'string' && futuresReview.body.includes('已实现盈亏'), JSON.stringify(futuresReview))
  assert('a slow review period cannot overwrite the newer one', Array.isArray(futuresReview.stats) && futuresReview.stats.some(text => text.includes('成交笔数') && text.trim().endsWith('30')), JSON.stringify(futuresReview.stats))
  const liveFutures = await scenario('live-futures')
  assert('futures rail re-prices on the polling tick', typeof liveFutures.rail === 'string' && liveFutures.rail.includes('3,300.00'), JSON.stringify(liveFutures))
  const futuresClose = await scenario('futures-close')
  assert('closing from the book fills a close ticket', futuresClose.hasClose === true && typeof futuresClose.ticket === 'string' && futuresClose.ticket.includes('平多') && futuresClose.qty === '1', JSON.stringify(futuresClose))
  assert('close ticket submits and reports the fill', typeof futuresClose.receipt === 'string' && futuresClose.receipt.includes('平') && futuresClose.receipt.includes('成交'), JSON.stringify(futuresClose))
  const quoteRace = await scenario('futures-quote-race')
  assert('a stale futures quote cannot paint over the new contract', typeof quoteRace.rail === 'string' && quoteRace.rail.includes('70,000.00') && !quoteRace.rail.includes('3,200.00'), JSON.stringify(quoteRace))
  const slotFallback = await scenario('slot-fallback')
  assert('empty K-line slot shows a loading hint first', typeof slotFallback.loadingHint === 'string' && slotFallback.loadingHint.includes('K 线加载中'), slotFallback.loadingHint ?? '')
  assert('empty K-line slot falls back to the built-in chart', slotFallback.chart === true && slotFallback.panelAlive === true, JSON.stringify(slotFallback))
  assert('empty K-line slot explains and offers a retry', typeof slotFallback.hint === 'string' && slotFallback.hint.includes('K 线视图未加载') && slotFallback.retryButton === true, JSON.stringify(slotFallback))

  const exceptions = consoleLines.filter(line => line.startsWith('EXCEPTION'))
  assert('no page exceptions', exceptions.length === 0, exceptions.join(' | '))
} catch (error) {
  console.error('FAIL  harness:', error.message)
  failures.push('harness')
} finally {
  await cleanup()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nUI e2e: all checks passed')
