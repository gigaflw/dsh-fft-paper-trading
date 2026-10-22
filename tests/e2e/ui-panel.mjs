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

const viewportWidth = Number(process.env.UI_WIDTH ?? 1440)
const child = spawn(chrome, [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${viewportWidth},1100`,
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
  assert('stock header labels total PnL correctly', stock.stats.some(text => text.includes('累计盈亏')) && !stock.stats.some(text => text.includes('浮动盈亏')), JSON.stringify(stock.stats))
  assert('zero PnL is neutral, not +0.00', !stock.stats.some(text => text.includes('+0.00')), JSON.stringify(stock.stats))
  assert('stock ticket keeps the aligned form grid', stock.ticketFields?.length === 7, JSON.stringify(stock.ticketFields))
  assert('an untouched ticket does not preview a negative balance', typeof stock.previewText === 'string' && !stock.previewText.includes('成交后现金'), JSON.stringify(stock.previewText))
  assert('a blank quantity reads as fill-in, not invalid', stock.submitTitle === '填写数量', JSON.stringify(stock.submitTitle))
  assert('an unpreviewed ticket hides the unknown max-buy figure', typeof stock.meta === 'string' && stock.meta.includes('可用') && !stock.meta.includes('最多可买'), JSON.stringify(stock.meta))
  assert('stock K-line rail renders', stock.kline === true)
  assert('stock book renders', typeof stock.book === 'string' && stock.book.includes('持仓'))
  assert('short symbol keeps the panel mounted', stock.shortSymbolAlive === true, stock.shortSymbolHint ?? '')
  assert('short symbol clears the previous candles', typeof stock.shortKline === 'string' && stock.shortKline.includes('暂无 K 线数据'), stock.shortKline ?? '')
  assert('limit draft keeps the quote', typeof stock.limitQuote === 'string' && stock.limitQuote.includes('现价'), stock.limitQuote ?? '')
  assert('limit draft blocks an empty price', stock.limitSubmitDisabled === true)
  await shot('stock-trade.png')

  // 2. 一揽子
  const nextTradeDate = await scenario('next-trade-date')
  assert('a rolled ledger date is labeled as the next trading day', typeof nextTradeDate.sub === 'string' && nextTradeDate.sub.includes('下一交易日'), JSON.stringify(nextTradeDate))
  const basketPreview = await scenario('basket-preview')
  assert('basket preview is shown before confirmation', typeof basketPreview.preview === 'string' && basketPreview.preview.includes('目标权重'), basketPreview.preview ?? '')
  assert('basket codes drop the exchange suffix', typeof basketPreview.preview === 'string' && basketPreview.preview.includes('600519') && !basketPreview.preview.includes('.XSHG'), basketPreview.preview ?? '')
  await shot('basket-preview.png')
  const reviewData = await scenario('review-data')
  assert('review renders stats, chart and all four tables', Array.isArray(reviewData.stats) && reviewData.stats.some(text => text.includes('成交笔数')) && reviewData.chart === true && Array.isArray(reviewData.tables) && reviewData.tables.filter(count => count > 0).length >= 4, JSON.stringify(reviewData))
  assert('a long trade list says it is truncated', typeof reviewData.truncation === 'string' && reviewData.truncation.includes('31'), JSON.stringify(reviewData.truncation))
  assert('the roundtrip table says it is aggregated per symbol', reviewData.turn === true, JSON.stringify(reviewData.turn))
  assert('the cash-flow genesis reads as initial cash, not 开户', reviewData.initial === true, JSON.stringify(reviewData.initial))
  assert('review marks losses with the down tone', Array.isArray(reviewData.negative) && reviewData.negative.some(text => text.includes('-1,234.56')), JSON.stringify(reviewData.negative))
  const reviewPoll = await scenario('review-poll')
  assert('the review tab refreshes its detail on the poll', reviewPoll.calls >= 1, JSON.stringify(reviewPoll))
  const marketRetry = await scenario('market-retry')
  assert('market failure is visible and 刷新 retries it', typeof marketRetry.error === 'string' && marketRetry.rows === 2 && marketRetry.errorAfter === null, JSON.stringify(marketRetry))
  const marketBoard = await scenario('market-board')
  assert('switching the board reloads page 1 for it', marketBoard.call?.board === 'star' && marketBoard.call?.page === 1 && typeof marketBoard.text === 'string', JSON.stringify(marketBoard))
  const marketStale = await scenario('market-stale-note')
  assert('a stale market list shows its notice', typeof marketStale.note === 'string' && marketStale.note.includes('缓存'), JSON.stringify(marketStale))
  const marketAdopt = await scenario('market-adopt')
  assert('clicking a market row fills the ticket', marketAdopt.tab === '交易' && marketAdopt.symbol === '600519', JSON.stringify(marketAdopt))
  const marketWatch = await scenario('market-watch')
  assert('market list renders and next is disabled on a short page', marketWatch.rows === 2 && marketWatch.nextDisabled === true, JSON.stringify(marketWatch))
  assert('watchlist adds and filters the market list', Array.isArray(marketWatch.added) && marketWatch.added.length === 1 && marketWatch.filteredRows === 1, JSON.stringify(marketWatch))
  assert('watchlist removes again', Array.isArray(marketWatch.removed) && marketWatch.removed.length === 0, JSON.stringify(marketWatch))
  assert('an empty watch filter shows guidance', typeof marketWatch.empty === 'string' && marketWatch.empty.includes('还没有自选'), JSON.stringify(marketWatch))
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
  const barsFlat = await scenario('bars-flat')
  assert('a flat K-line series renders without NaN', barsFlat.chart === true && barsFlat.nan === false, JSON.stringify(barsFlat))
  const symbolPaste = await scenario('symbol-paste')
  assert('a pasted SH600519 becomes 600519', symbolPaste.value === '600519', JSON.stringify(symbolPaste))
  assert('full-width digits become a stock code', symbolPaste.fullWidth === '600519', JSON.stringify(symbolPaste))
  const quoteRetry = await scenario('quote-retry')
  assert('failed quote is visible and refresh recovers it', typeof quoteRetry.error === 'string' && typeof quoteRetry.quote === 'string' && quoteRetry.quote.includes('现价'), JSON.stringify(quoteRetry))
  const stockClose = await scenario('stock-close')
  assert('T+1-locked position explains the disabled sell', stockClose.t1Disabled === true && typeof stockClose.t1Title === 'string' && stockClose.t1Title.includes('T+1'), JSON.stringify(stockClose))
  assert('selling a position fills and submits the ticket', stockClose.side === '卖出' && stockClose.qty === '100' && stockClose.submitLabel === '卖出' && typeof stockClose.receipt === 'string' && stockClose.receipt.includes('卖出'), JSON.stringify(stockClose))
  const stockLimit = await scenario('stock-limit')
  assert('a resting limit order shows the pending receipt', typeof stockLimit.receipt === 'string' && stockLimit.receipt.includes('挂单') && stockLimit.receipt.includes('11.40'), JSON.stringify(stockLimit))
  const cancelOrder = await scenario('cancel-order')
  assert('cancelling a pending order clears the table', typeof cancelOrder.empty === 'string' && cancelOrder.empty.includes('无挂单'), JSON.stringify(cancelOrder))
  assert('a queued order explains that it waits for the next session', typeof cancelOrder.note === 'string' && cancelOrder.note.includes('下一交易时段'), JSON.stringify(cancelOrder.note))
  const ordersTruncation = await scenario('orders-truncation')
  assert('a long order history says it is truncated', typeof ordersTruncation.note === 'string' && ordersTruncation.note.includes('共 31 条'), JSON.stringify(ordersTruncation))
  assert('a stock order note is visible in history', ordersTruncation.hasNote === true, JSON.stringify(ordersTruncation))
  assert('a long order note is ellipsized', typeof ordersTruncation.noteWidth === 'number' && ordersTruncation.noteWidth <= 190, JSON.stringify(ordersTruncation.noteWidth))
  const stockReasons = await scenario('stock-reasons')
  assert('stock keeps its 可卖不足 wording', typeof stockReasons.text === 'string' && stockReasons.text.includes('可卖不足') && !stockReasons.text.includes('可平不足'), JSON.stringify(stockReasons))
  const resetAccount = await scenario('reset-account')
  assert('resetting the stock account reports success', typeof resetAccount.notice === 'string' && resetAccount.notice.includes('账户已重置'), JSON.stringify(resetAccount))
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
  const resetBasket = await scenario('reset-basket')
  assert('resetting the account drops the basket preview', resetBasket.rowsBefore > 0 && resetBasket.rowsAfter === 0 && resetBasket.confirmAfter === 0, JSON.stringify(resetBasket))
  const basketOversize = await scenario('basket-oversize')
  assert('an oversize CSV is rejected before upload', typeof basketOversize.error === 'string' && basketOversize.error.includes('32 KiB'), JSON.stringify(basketOversize))
  const basketBudget = await scenario('basket-budget')
  assert('an invalid basket budget is caught immediately', basketBudget.disabled === '预算需为正数' && basketBudget.note === true, JSON.stringify(basketBudget))
  assert('full-width budget digits are normalised', basketBudget.budget === '10000', JSON.stringify(basketBudget))
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
  const futuresQuoteStale = await scenario('futures-quote-stale')
  assert('a stale futures quote shows its notice', typeof futuresQuoteStale.note === 'string' && futuresQuoteStale.note.includes('缓存'), JSON.stringify(futuresQuoteStale))
  const previewed = await scenario('futures-preview')
  assert('futures ticket shows the quote update time', typeof previewed.quoteLine === 'string' && previewed.quoteLine.includes('更新'), JSON.stringify(previewed.quoteLine))
  assert('futures preview shows margin and risk', typeof previewed.preview === 'string' && previewed.preview.includes('保证金') && previewed.preview.includes('风险度'), previewed.preview ?? '')
  await shot('futures-preview.png')
  const submitted = await scenario('futures-submit')
  assert('futures order fills', typeof submitted.receipt === 'string' && submitted.receipt.includes('成交'), submitted.receipt ?? '')
  assert('futures position book updates', typeof submitted.book === 'string' && submitted.book.includes('RB2611.SHFE'), submitted.book ?? '')
  await shot('futures-position.png')
  const futuresCalls = await evaluate('window.__calls.filter(item => item.startsWith("futures/"))')
  assert('futures RPCs were called', ['futures/account/get', 'futures/contracts', 'futures/preview', 'futures/order'].every(item => futuresCalls.includes(item)), JSON.stringify(futuresCalls))

  const futuresPositionsClose = await scenario('futures-positions-close')
  assert('closing from the positions tab fills a close ticket', futuresPositionsClose.tab === '交易' && futuresPositionsClose.direction === '平多' && futuresPositionsClose.qty === '1', JSON.stringify(futuresPositionsClose))
  const futuresContractStale = await scenario('futures-contract-stale')
  assert('a stale contract index shows its notice', typeof futuresContractStale.note === 'string' && futuresContractStale.note.includes('缓存'), JSON.stringify(futuresContractStale))
  const futuresSearchRace = await scenario('futures-search-race')
  assert('a stale contract search cannot overwrite the latest', typeof futuresSearchRace.results === 'string' && futuresSearchRace.results.includes('CU2611') && !futuresSearchRace.results.includes('RB2611'), JSON.stringify(futuresSearchRace))
  const futuresPlaceRetry = await scenario('futures-place-retry')
  assert('a retried futures order reuses the request id', Array.isArray(futuresPlaceRetry.ids) && futuresPlaceRetry.ids.length === 2 && futuresPlaceRetry.ids[0] === futuresPlaceRetry.ids[1], JSON.stringify(futuresPlaceRetry))
  const futuresLimit = await scenario('futures-limit')
  assert('a resting futures limit shows the pending receipt', typeof futuresLimit.receipt === 'string' && futuresLimit.receipt.includes('挂单') && futuresLimit.receipt.includes('3,300.00'), JSON.stringify(futuresLimit))
  const futuresCancel = await scenario('futures-cancel')
  assert('cancelling a futures pending order clears the table', typeof futuresCancel.empty === 'string' && futuresCancel.empty.includes('无挂单'), JSON.stringify(futuresCancel))
  const futuresReset = await scenario('futures-reset')
  assert('resetting the futures account reports success', typeof futuresReset.notice === 'string' && futuresReset.notice.includes('期货账户已重置'), JSON.stringify(futuresReset))
  const futuresLimitBand = await scenario('futures-limit-band')
  assert('a limit outside the futures band is disabled', futuresLimitBand.title === '价格超出涨跌停', JSON.stringify(futuresLimitBand))
  const futuresPreopen = await scenario('futures-preopen')
  assert('the pre-open futures label reads 待开盘', typeof futuresPreopen.header === 'string' && futuresPreopen.header.includes('待开盘'), JSON.stringify(futuresPreopen))
  const futuresLunch = await scenario('futures-lunch')
  assert('a futures break reads 休市, not 午休', typeof futuresLunch.header === 'string' && futuresLunch.header.includes('休市'), JSON.stringify(futuresLunch))
  const futuresReasons = await scenario('futures-reasons')
  assert('futures cancel reasons are localized', typeof futuresReasons.reason === 'string' && futuresReasons.reason.includes('可用资金不足') && futuresReasons.reason.includes('可平不足') && !futuresReasons.reason.includes('margin_unavailable'), JSON.stringify(futuresReasons))
  assert('a futures order note is visible in history', typeof futuresReasons.reason === 'string' && futuresReasons.reason.includes('期货备注'), JSON.stringify(futuresReasons))
  const futuresProduct = await scenario('futures-product-label')
  assert('futures product codes are uppercase', typeof futuresProduct.text === 'string' && futuresProduct.text.includes('RB'), JSON.stringify(futuresProduct))
  const futuresReview = await scenario('futures-review')
  assert('futures review renders without a stale variable', typeof futuresReview.body === 'string' && futuresReview.body.includes('已实现盈亏'), JSON.stringify(futuresReview))
  assert('a slow review period cannot overwrite the newer one', Array.isArray(futuresReview.stats) && futuresReview.stats.some(text => text.includes('成交笔数') && text.trim().endsWith('30')), JSON.stringify(futuresReview.stats))
  const liveFutures = await scenario('live-futures')
  assert('futures rail re-prices on the polling tick', typeof liveFutures.rail === 'string' && liveFutures.rail.includes('3,300.00'), JSON.stringify(liveFutures))
  const futuresReviewPoll = await scenario('futures-review-poll')
  assert('the futures review refreshes on the poll', futuresReviewPoll.calls >= 1, JSON.stringify(futuresReviewPoll))
  const futuresClose = await scenario('futures-close')
  assert('closing from the book fills a close ticket', futuresClose.hasClose === true && typeof futuresClose.ticket === 'string' && futuresClose.ticket.includes('平多') && futuresClose.qty === '1', JSON.stringify(futuresClose))
  assert('close ticket submits and reports the fill', typeof futuresClose.receipt === 'string' && futuresClose.receipt.includes('平') && futuresClose.receipt.includes('成交'), JSON.stringify(futuresClose))
  const quoteRace = await scenario('futures-quote-race')
  assert('a stale futures quote cannot paint over the new contract', typeof quoteRace.rail === 'string' && quoteRace.rail.includes('70,000.00') && !quoteRace.rail.includes('3,200.00'), JSON.stringify(quoteRace))
  const futuresNoQuote = await scenario('futures-no-quote')
  assert('a futures market order without a quote is blocked', typeof futuresNoQuote.title === 'string' && typeof futuresNoQuote.preview === 'string' && futuresNoQuote.preview.includes('没有可用行情'), JSON.stringify(futuresNoQuote))
  const stockInsufficient = await scenario('stock-insufficient')
  assert('an unaffordable buy is disabled with a reason', stockInsufficient.title === '资金不足', JSON.stringify(stockInsufficient))
  const stockOversell = await scenario('stock-oversell')
  assert('an oversell is disabled with a reason', stockOversell.title === '可卖不足', JSON.stringify(stockOversell))
  const stockLimitBand = await scenario('stock-limit-band')
  assert('a limit outside the stock band is disabled', stockLimitBand.title === '价格超出涨跌停', JSON.stringify(stockLimitBand))
  const stockNoQuote = await scenario('stock-no-quote')
  assert('a market order without a quote is blocked with a reason', typeof stockNoQuote.title === 'string' && typeof stockNoQuote.preview === 'string' && stockNoQuote.preview.includes('没有可用行情'), JSON.stringify(stockNoQuote))
  const stockSuspended = await scenario('stock-suspended')
  assert('a suspended stock is disabled with a reason', stockSuspended.title === '停牌', JSON.stringify(stockSuspended))
  const stockPreopen = await scenario('stock-preopen')
  assert('pre-open still allows a limit order to be planted', stockPreopen.enabled === true && typeof stockPreopen.header === 'string' && stockPreopen.header.includes('仅可预埋限价单'), JSON.stringify(stockPreopen))
  const stockAuctionClose = await scenario('stock-auction-close')
  assert('auction-close limit orders are blocked with an explanation', stockAuctionClose.title === '收盘竞价暂不支持模拟撮合' && typeof stockAuctionClose.header === 'string' && stockAuctionClose.header.includes('收盘竞价暂不支持下单'), JSON.stringify(stockAuctionClose))
  const reviewRace2 = await scenario('review-race2')
  assert('a slow stock review period cannot overwrite the newer one (isolated)', Array.isArray(reviewRace2.stats) && reviewRace2.stats.some(text => text.includes('成交笔数') && text.trim().endsWith('30')), JSON.stringify(reviewRace2))
  const lockedAccount = await scenario('locked-account')
  assert('a locked account explains the file and disables the ticket', typeof lockedAccount.blocked === 'string' && lockedAccount.blocked.includes('events.jsonl') && lockedAccount.submitDisabled === true && lockedAccount.submitTitle === '账户已锁定', JSON.stringify(lockedAccount))
  assert('a locked account offers export and copy', lockedAccount.exportButton === 1 && lockedAccount.copyButton === 1, JSON.stringify(lockedAccount))
  const futuresLocked = await scenario('futures-locked')
  assert('a locked futures account has the same recovery affordances', typeof futuresLocked.blocked === 'string' && futuresLocked.blocked.includes('期货账本校验失败') && futuresLocked.exportButton === 1 && futuresLocked.copyButton === 1 && typeof futuresLocked.copyNotice === 'string' && futuresLocked.copyNotice.includes('账本路径') && futuresLocked.submitDisabled === true && futuresLocked.submitTitle === '账户已锁定', JSON.stringify(futuresLocked))
  const marketClosed = await scenario('market-closed')
  assert('a closed market labels its prices as the latest snapshot', typeof marketClosed.note === 'string' && marketClosed.note.includes('非交易时段'), JSON.stringify(marketClosed))
  const marketAuction = await scenario('market-auction')
  assert('auction-close market note names the closing auction', typeof marketAuction.note === 'string' && marketAuction.note.includes('收盘竞价中'), JSON.stringify(marketAuction))
  const marketPreopen = await scenario('market-preopen')
  assert('pre-open market note names the opening auction', typeof marketPreopen.note === 'string' && marketPreopen.note.includes('集合竞价中'), JSON.stringify(marketPreopen))
  const placeRetry = await scenario('place-retry')
  assert('a retried order reuses the request id', Array.isArray(placeRetry.ids) && placeRetry.ids.length === 2 && placeRetry.ids[0] === placeRetry.ids[1], JSON.stringify(placeRetry))
  const placeDouble = await scenario('place-double')
  assert('a double submit places one order', placeDouble.calls === 1 && typeof placeDouble.receipt === 'string', JSON.stringify(placeDouble))
  const accountRetry = await scenario('account-retry')
  assert('a failed account load can be retried', typeof accountRetry.error === 'string' && accountRetry.retry === 1 && typeof accountRetry.loaded === 'string', JSON.stringify(accountRetry))
  const futuresAccountRetry = await scenario('futures-account-retry')
  assert('a failed futures account load can be retried', typeof futuresAccountRetry.error === 'string' && futuresAccountRetry.retry === 1 && typeof futuresAccountRetry.loaded === 'string', JSON.stringify(futuresAccountRetry))
  const slotIdentity = await scenario('slot-identity')
  assert('a K-line selection fills the ticket symbol', slotIdentity.symbol === '000001' && typeof slotIdentity.notice === 'string' && slotIdentity.notice.includes('平安银行'), JSON.stringify(slotIdentity))
  const slotFallback = await scenario('slot-fallback')
  assert('empty K-line slot shows a loading hint first', typeof slotFallback.loadingHint === 'string' && slotFallback.loadingHint.includes('K 线加载中'), slotFallback.loadingHint ?? '')
  assert('empty K-line slot falls back to the built-in chart', slotFallback.chart === true && slotFallback.panelAlive === true, JSON.stringify(slotFallback))
  assert('empty K-line slot explains and offers a retry', typeof slotFallback.hint === 'string' && slotFallback.hint.includes('K 线视图未加载') && slotFallback.retryButton === true, JSON.stringify(slotFallback))

  const layout = await evaluate('({ inner: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth })')
  assert('the page has no horizontal overflow', layout.doc <= layout.inner + 1, JSON.stringify(layout))
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
