/* Fake RPC backend + mount + scenarios for the UI harness. Runs in the page. */
(function () {
  const ts = () => new Date().toISOString()
  const stockAccount = {
    accountId: 'default', currency: 'CNY', initialCash: 1000000, cash: 985000,
    marketValue: 15000, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0,
    tradeDate: '2026-10-22', blocked: false,
    positions: [
      { symbol: '600519.XSHG', name: '贵州茅台', qty: 100, available: 100, avgCost: 1400, lastPrice: 1450.5, marketValueCents: 14505000, unrealizedPnlCents: 505000, unrealizedPnlPct: 0.036 },
      { symbol: '000001.XSHE', name: '平安银行', qty: 5000, available: 0, avgCost: 11.2, lastPrice: 11.3, marketValueCents: 5650000, unrealizedPnlCents: 50000, unrealizedPnlPct: 0.0089 },
    ],
    settings: {},
  }
  const quote = { symbol: '600519.XSHG', name: '贵州茅台', last: 1450.5, prevClose: 1440, marketTs: ts(), source: 'fake' }
  const preview = {
    symbol: '600519.XSHG', side: 'buy', type: 'market', qty: 100, price: 1450.5,
    amountCents: 14505000, commissionCents: 500, stampCents: 0, transferCents: 14,
    totalFeesCents: 514, cashAfterCents: 98500000 - 14505000 - 514, availableQty: 100, maxBuyQty: 600,
    quote, warnings: [],
  }
  const stockOrders = []
  const stockTrades = []

  // --- futures fake state ---------------------------------------------------
  const futuresContract2 = {
    symbol: 'CU2611.SHFE', name: '沪铜2611', product: 'cu', exchange: 'SHFE',
    multiplier: 5, tickSize: 10, marginRate: 0.1, deListDate: '2026-11-15',
    tradeHours: '上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)',
  }
  const futuresContract = {
    symbol: 'RB2611.SHFE', name: '螺纹钢2611', product: 'rb', exchange: 'SHFE',
    multiplier: 10, tickSize: 1, marginRate: 0.1, deListDate: '2026-11-15',
    tradeHours: '上午9:00-11:30,下午13:30-15:00',
  }
  const futuresQuote = { symbol: 'RB2611.SHFE', name: '螺纹钢2611', last: 3200, preSettlement: 3150, openInterest: 120000, volume: 500000, marketTs: ts(), tradeDate: '2026-10-22' }
  const futuresStatus = { phase: 'trading', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }
  const futuresState = {
    account: { accountId: 'futures', currency: 'CNY', initialCash: 1000000, cash: 1000000, margin: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0, riskRatio: 0, tradeDate: '2026-10-22', blocked: false, positions: [], settings: { warnRiskRatio: 0.8, liquidateRiskRatio: 1 } },
    orders: [],
    trades: [],
    positions: [],
  }
  const futuresPreview = (draft) => {
    const price = window.__futuresLast ?? 3200
    const multiplier = 10
    const amountCents = Math.round(price * multiplier * draft.qty * 100)
    const marginCents = Math.round(amountCents * 0.1)
    const feesCents = 500 * draft.qty
    return {
      symbol: draft.symbol, side: draft.side, offset: draft.offset, type: draft.type, qty: draft.qty,
      price, multiplier, amountCents, marginCents, feesCents,
      cashAfterCents: futuresState.account.cash * 100 - marginCents - feesCents,
      equityAfter: futuresState.account.equity * 100,
      riskRatioAfter: (futuresState.account.margin * 100 + marginCents) / (futuresState.account.equity * 100),
      maxOpenQty: 28,
      availableCloseQty: draft.offset === 'close' ? (futuresState.positions.find(item => item.symbol === draft.symbol && item.side === draft.side)?.qty ?? 0) : 0,
      limit: { symbol: draft.symbol, upper: 3400, lower: 2900, ratio: 0.1, source: 'limit' },
      quote: { ...futuresQuote, last: price, marketTs: ts() }, session: futuresStatus, warnings: [],
    }
  }

  const handlers = {
    'account/get': () => stockAccount,
    'account/export': () => ({ path: '/tmp/paper-trading/events.jsonl', exists: true, content: '{"type":"account.opened"}\n' }),
    'account/reset': () => stockAccount,
    'list/orders': () => window.__pendingOrders ?? stockOrders,
    'order/cancel': (payload) => {
      window.__pendingOrders = []
      return {
        id: payload.orderId, requestId: 'r-cancel', symbol: '600519.XSHG', side: 'buy', type: 'limit',
        qty: 100, limitPrice: 11.4, status: 'canceled', reason: '手动撤单',
        createdAt: ts(), updatedAt: ts(),
      }
    },
    'list/trades': () => stockTrades,
    'review/get': () => ({ equityCurve: [], maxDrawdownPct: 0, tradeCount: 0, buyCount: 0, sellCount: 0, totalFees: 0, realizedPnl: 0, days: 0 }),
    'market/status': () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }),
    'review/daily': () => [],
    'cash/flow': () => [],
    'review/roundtrips': () => [],
    'market/bars': () => ({ state: 'ok', bars: Array.from({ length: 30 }, (_, i) => ({ time: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`, open: 1400 + i, high: 1420 + i, low: 1380 + i, close: 1410 + i })) }),
    'market/quote': () => ({ state: 'ok', quotes: [{ ...quote, last: window.__quoteLast ?? quote.last, marketTs: ts() }] }),
    'market/search': query => (query === 'zzzzzz' ? [] : [{ symbol: '600519.XSHG', name: '贵州茅台' }]),
    'order/preview': (payload) => {
      const last = window.__quoteLast ?? quote.last
      return {
        ...preview,
        price: last,
        side: payload?.side ?? preview.side,
        type: payload?.type ?? preview.type,
        qty: payload?.qty ?? preview.qty,
        quote: { ...quote, last, marketTs: ts() },
      }
    },
    'order/place': (payload) => {
      const draft = payload.draft ?? payload
      return {
        id: 'o-1', requestId: payload.requestId ?? 'r-1', symbol: draft.symbol, side: draft.side,
        type: draft.type, qty: draft.qty, status: 'filled', fillPrice: quote.last,
        createdAt: ts(), updatedAt: ts(), filledAt: ts(),
      }
    },
    'tick': () => ({ tradeDate: '2026-10-22', filled: [], expired: [], notices: [], quotes: [] }),
    'market/list': payload => ({
      state: 'ok',
      page: payload.page ?? 1,
      quotes: [
        { symbol: '600519.XSHG', name: '贵州茅台', last: 1450.5, prevClose: 1430, status: 'trading' },
        { symbol: '000001.XSHE', name: '平安银行', last: 11.3, prevClose: 11.4, status: 'trading' },
      ],
    }),
    'watchlist/get': () => ({ symbols: window.__watchSymbols ?? [] }),
    'watchlist/set': payload => {
      window.__watchSymbols = payload.symbols
      window.__watchCalls = [...(window.__watchCalls ?? []), payload.symbols]
      return { symbols: payload.symbols }
    },

    // --- basket -------------------------------------------------------------
    'basket/preview': (payload) => {
      const rowsInFile = String(payload.csv ?? '').split('\n').map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#'))
      const header = rowsInFile.length > 0 && !/\d/.test(rowsInFile[0].split(',')[1] ?? '') ? 1 : 0
      if (rowsInFile.length - header > 20) {
        return { __error: { code: 'INVALID_ARGUMENT', message: `一揽子最多 20 只，本次 ${rowsInFile.length - header} 只` } }
      }
      const budgetCents = typeof payload.budgetCents === 'number' ? payload.budgetCents : 100000000
      const rows = [
        { symbol: '600519', name: '贵州茅台', weight: 0.3, targetCents: Math.floor(budgetCents * 0.3), price: 1450.5, qty: 100, amountCents: 14505000, feesCents: 3626, actualWeight: 0.145, status: 'ok' },
        { symbol: '000001', name: '平安银行', weight: 0.2, targetCents: Math.floor(budgetCents * 0.2), price: 11.3, qty: 8800, amountCents: 9944000, feesCents: 2983, actualWeight: 0.099, status: 'ok' },
        { symbol: '300750', name: '宁德时代', weight: 0.5, targetCents: Math.floor(budgetCents * 0.5), price: 240, qty: 0, amountCents: 0, feesCents: 0, actualWeight: 0, status: 'zero_lot', warning: '一手约 24000 元' },
      ]
      const totalAmountCents = rows.reduce((sum, row) => sum + row.amountCents, 0)
      const totalFeesCents = rows.reduce((sum, row) => sum + row.feesCents, 0)
      return {
        budgetCents, cashCents: stockAccount.cash * 100, rows, issues: [], warnings: [],
        totalAmountCents, totalFeesCents,
        residualCents: budgetCents - totalAmountCents - totalFeesCents,
        cashAfterCents: stockAccount.cash * 100 - totalAmountCents - totalFeesCents,
        session: { phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true },
      }
    },
    'basket/place': (payload) => {
      window.__basketBatchIds.push(payload.batchId)
      const rows = payload.rows.map((row, index) => ({
        symbol: row.symbol,
        order: { id: `b-${index}`, requestId: `${payload.batchId}:${row.symbol}`, symbol: row.symbol, side: 'buy', type: 'market', qty: row.qty, status: 'filled', fillPrice: index === 0 ? 1450.5 : 11.3, createdAt: ts(), updatedAt: ts() },
      }))
      return { batchId: payload.batchId, rows, cashAfterCents: 81000000 }
    },

    // --- futures ------------------------------------------------------------
    'futures/account/get': () => futuresState.account,
    'futures/account/reset': () => futuresState.account,
    'futures/account/export': () => ({ path: '/tmp/futures/events.jsonl', exists: true, content: '{}' }),
    'futures/contracts': () => ({ state: 'ok', contracts: [futuresContract, futuresContract2] }),
    'futures/quote': () => ({ state: 'ok', quotes: [{ ...futuresQuote, last: window.__futuresLast ?? futuresQuote.last, marketTs: ts() }] }),
    'futures/status': () => futuresStatus,
    'futures/preview': draft => futuresPreview(draft),
    'futures/order': (payload) => {
      const draft = payload.draft
      const order = {
        id: 'f-1', requestId: payload.requestId, symbol: draft.symbol, name: futuresContract.name,
        side: draft.side, offset: draft.offset, type: draft.type, qty: draft.qty,
        status: 'filled', createdAt: ts(), updatedAt: ts(), filledAt: ts(), fillPrice: 3200,
        marginCents: 320000, feesCents: 500,
      }
      futuresState.orders = [order]
      futuresState.trades = [{ id: 't-1', orderId: order.id, symbol: draft.symbol, side: draft.side, offset: draft.offset, price: 3200, qty: draft.qty, multiplier: 10, amountCents: 3200000, feesCents: 500, ts: ts(), tradeDate: '2026-10-22' }]
      if (draft.offset === 'open') {
        futuresState.positions = [{ symbol: draft.symbol, name: futuresContract.name, side: draft.side, qty: draft.qty, todayQty: draft.qty, avgPrice: 3200, lastPrice: 3200, multiplier: 10, marginCents: 320000, marginRate: 0.1, unrealizedPnlCents: 0, unrealizedPnlPct: 0, deListDate: '2026-11-15' }]
        futuresState.account = { ...futuresState.account, cash: 996500, margin: 320000, equity: 1000000, riskRatio: 0.32, positions: futuresState.positions }
      } else {
        futuresState.positions = []
        futuresState.account = { ...futuresState.account, cash: 1000000, margin: 0, equity: 1000000, riskRatio: 0 }
      }
      return order
    },
    'futures/cancel': (payload) => ({ id: payload.orderId, requestId: 'r', symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'limit', qty: 1, status: 'canceled', createdAt: ts(), updatedAt: ts() }),
    'futures/positions': () => futuresState.positions,
    'futures/orders': () => futuresState.orders,
    'futures/trades': () => futuresState.trades,
    'futures/review': () => ({ equityCurve: [], maxDrawdownPct: 0, tradeCount: futuresState.trades.length, openCount: 0, closeCount: 0, winCount: 0, lossCount: 0, totalFees: 500, realizedPnl: 0, byProduct: [{ product: 'rb', tradeCount: 1, realizedPnl: 0 }] }),
    'futures/tick': () => ({ tradeDate: '2026-10-22', filled: [], expired: [], notices: [] }),
  }

  window.__baseStockAccount = stockAccount
  window.__calls = []
  window.__basketBatchIds = []
  window.__fake = {
    on(endpoint, fn) { handlers[endpoint] = fn },
    state: futuresState,
    counts: () => window.__calls.reduce((acc, key) => (acc[key] = (acc[key] || 0) + 1, acc), {}),
  }
  window.fetch = async (url, init) => {
    const body = JSON.parse(init && init.body ? init.body : '{}')
    const endpoint = body.endpoint
    window.__calls.push(endpoint)
    const handler = handlers[endpoint]
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'fake: ' + endpoint } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const resolved = await handler(body.payload ?? {})
    if (resolved && resolved.__error) {
      return new Response(JSON.stringify({ ok: false, error: resolved.__error }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, value: resolved }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  // --- e2e helpers ----------------------------------------------------------
  window.__e2e = window.__e2e || {}
  window.__e2e.visible = el => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  window.__e2e.byText = text => [...document.querySelectorAll('button,a,[role=tab],[role=button],td,th,label,span,div')]
    .filter(el => (el.children.length === 0 || ['BUTTON', 'A'].includes(el.tagName)))
    .filter(el => (el.textContent || '').trim() === text && window.__e2e.visible(el))
  window.__e2e.click = el => {
    const rect = el.getBoundingClientRect()
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.dispatchEvent(new MouseEvent('click', opts))
  }
  window.__e2e.setInput = (input, value) => {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  window.__e2e.wait = async (fn, timeout = 4000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const value = fn()
      if (value) return value
      await new Promise(done => setTimeout(done, 50))
    }
    return null
  }
  window.__e2e.text = selector => document.querySelector(selector)?.innerText ?? ''

  // --- scenarios ------------------------------------------------------------
  window.__scenario = async name => {
    const e2e = window.__e2e
    const result = { name }
    if (name === 'stock') {
      result.tabs = [...document.querySelectorAll('.pt-tab')].map(el => el.textContent.trim())
      result.stats = [...document.querySelectorAll('.pt-stat')].map(el => el.innerText.replace(/\n/g, ' '))
      result.previewText = e2e.text('.pt-preview-pane')
      result.submitTitle = document.querySelector('.pt-ticket-submit')?.title ?? null
      result.meta = e2e.text('.pt-ticket-meta')
      result.ticketFields = [...document.querySelectorAll('.pt-ticket-form > *')].map(el => el.className)
      result.book = e2e.text('.pt-trade-book').replace(/\n/g, ' ')
      result.kline = Boolean(document.querySelector('.pt-kline-body'))
      // An unfinished draft triggers the quote-only path; a removed state setter
      // here used to throw and unmount the whole panel.
      const symbolInput = document.querySelector('.pt-ticket-form input.pt-input')
      e2e.setInput(symbolInput, '600')
      await new Promise(done => setTimeout(done, 500))
      result.shortSymbolAlive = Boolean(document.querySelector('.pt-root'))
      result.shortSymbolHint = e2e.text('.pt-ticket-form')
      result.shortKline = e2e.text('.pt-kline-body')
      e2e.setInput(symbolInput, '600519')
      await new Promise(done => setTimeout(done, 500))
      // A complete preview must leave the quote available for the 限价 draft.
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 600))
      result.limitQuote = document.querySelector('.pt-quote')?.innerText ?? null
      result.limitSubmitDisabled = document.querySelector('.pt-ticket-submit')?.disabled ?? null
      e2e.click(e2e.byText('市价')[0])
      await new Promise(done => setTimeout(done, 300))
      return result
    }
    if (name === 'bars-fail') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 400))
      window.__fake.on('market/bars', () => ({ state: 'failed', bars: [], notice: 'K 线数据暂不可用' }))
      const input = document.querySelector('.pt-ticket-form input')
      e2e.setInput(input, '600000')
      result.hint = await e2e.wait(() => {
        const text = document.querySelector('.pt-kline-hint')?.innerText ?? ''
        return text.includes('K 线数据暂不可用') ? text : null
      }, 5000)
      window.__fake.on('market/bars', () => ({ state: 'ok', bars: Array.from({ length: 30 }, (_, i) => ({ time: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`, open: 1400 + i, high: 1420 + i, low: 1380 + i, close: 1410 + i })) }))
      return result
    }
    if (name === 'bars-race') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 400))
      e2e.click(e2e.byText('分时')[0])
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('market/bars', async payload => {
        const minute = payload.interval === 'minute'
        await new Promise(done => setTimeout(done, minute ? 50 : 400))
        return {
          state: 'ok',
          bars: minute
            ? Array.from({ length: 30 }, (_, i) => ({ time: `2026-10-22T${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, open: 1400 + i, high: 1420 + i, low: 1380 + i, close: 1410 + i }))
            : [],
        }
      })
      e2e.click(e2e.byText('日K')[0])
      await new Promise(done => setTimeout(done, 60))
      e2e.click(e2e.byText('分时')[0])
      await new Promise(done => setTimeout(done, 800))
      result.chart = Boolean(document.querySelector('.pt-kline-body .pt-chart'))
      result.body = e2e.text('.pt-kline-body')
      window.__fake.on('market/bars', () => ({ state: 'ok', bars: Array.from({ length: 30 }, (_, i) => ({ time: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`, open: 1400 + i, high: 1420 + i, low: 1380 + i, close: 1410 + i })) }))
      return result
    }
    if (name === 'bars-flat') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('market/bars', () => ({
        state: 'ok',
        bars: Array.from({ length: 30 }, (_, index) => ({
          time: `2026-09-${String(index % 28 + 1).padStart(2, '0')}`,
          open: 10, high: 10, low: 10, close: 10,
        })),
      }))
      const refresh = [...document.querySelectorAll('.pt-kline-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.chart = await e2e.wait(() => Boolean(document.querySelector('.pt-kline-body .pt-chart')), 5000)
      result.nan = (document.querySelector('.pt-kline-body')?.innerHTML ?? '').includes('NaN')
      return result
    }
    if (name === 'symbol-paste') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[0], 'SH600519')
      result.value = inputs[0].value
      e2e.setInput(inputs[0], '６００５１９')
      result.fullWidth = inputs[0].value
      return result
    }
    if (name === 'quote-retry') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 400))
      window.__fake.on('market/quote', () => ({ state: 'failed', quotes: [], notice: '行情暂不可用' }))
      e2e.click(e2e.byText('限价')[0])
      const symbolInput = document.querySelector('.pt-ticket-form input')
      e2e.setInput(symbolInput, '600001')
      result.error = await e2e.wait(() => {
        const text = document.querySelector('.pt-ticket-form')?.innerText ?? ''
        return text.includes('行情暂不可用') || text.includes('未取到行情') ? text : null
      }, 5000)
      window.__fake.on('market/quote', () => ({ state: 'ok', quotes: [{ ...window.__fake.quote ?? {}, symbol: '600001.XSHG', name: '邯郸钢铁', last: 10.5, prevClose: 10.4, marketTs: ts(), source: 'fake' }] }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.quote = await e2e.wait(() => {
        const text = document.querySelector('.pt-quote')?.innerText ?? ''
        return text.includes('现价') ? text : null
      }, 5000)
      return result
    }
    if (name === 'live-stock') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 400))
      window.__quoteLast = 1500
      result.quote = await e2e.wait(() => {
        const text = document.querySelector('.pt-quote')?.innerText ?? ''
        return text.includes('1,500.00') ? text : null
      }, 9000)
      return result
    }
    if (name === 'live-futures') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 400))
      window.__futuresLast = 3300
      result.rail = await e2e.wait(() => {
        const text = document.querySelector('.pt-futures-rail')?.innerText ?? ''
        return text.includes('3,300.00') ? text : null
      }, 9000)
      return result
    }
    if (name === 'stock-close') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('持仓'))
      e2e.click(tab)
      await e2e.wait(() => [...document.querySelectorAll('.pt-main tbody tr')].length >= 2)
      const rows = [...document.querySelectorAll('.pt-main tbody tr')].map(row => ({
        text: row.innerText,
        button: row.querySelector('button'),
      }))
      const locked = rows.find(row => row.text.includes('000001'))
      result.t1Disabled = locked?.button?.disabled ?? null
      result.t1Title = locked?.button?.title ?? null
      const sellable = rows.find(row => row.text.includes('600519'))
      if (sellable?.button) e2e.click(sellable.button)
      await new Promise(done => setTimeout(done, 500))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      result.side = [...document.querySelectorAll('.pt-ticket-form .pt-seg button')]
        .find(button => button.getAttribute('data-active') === 'true')?.innerText ?? null
      result.qty = inputs[1]?.value ?? null
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      result.submitLabel = submit?.innerText ?? null
      if (submit) e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('卖出') ? text : null
      }, 5000)
      return result
    }
    if (name === 'stock-limit') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('order/place', (payload) => {
        const draft = payload.draft ?? payload
        return {
          id: 'o-limit', requestId: payload.requestId ?? 'r-limit', symbol: draft.symbol,
          side: draft.side, type: draft.type, qty: draft.qty, limitPrice: draft.limitPrice,
          status: 'pending', createdAt: ts(), updatedAt: ts(),
        }
      })
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '100')
      e2e.setInput(inputs[2], '11.40')
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      if (!submit) throw new Error('place-retry: submit disabled; title=' + (document.querySelector('.pt-ticket-submit')?.title ?? 'none'))
      e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('挂单') ? text : null
      }, 5000)
      return result
    }
    if (name === 'cancel-order') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('订单'))
      e2e.click(tab)
      window.__pendingOrders = [{
        id: 'o-cancel', requestId: 'r-pending', symbol: '600519.XSHG', side: 'buy', type: 'limit',
        qty: 100, limitPrice: 11.4, status: 'queued', createdAt: ts(), updatedAt: ts(),
      }]
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.note = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('下一交易时段'))
        return node ? node.innerText.trim() : null
      }, 3000)
      const cancel = await e2e.wait(() => e2e.byText('撤单')[0] ?? null, 4000)
      e2e.click(cancel)
      result.empty = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('无挂单') ? text : null
      }, 4000)
      return result
    }
    if (name === 'orders-truncation') {
      window.__fake.on('list/orders', () => Array.from({ length: 31 }, (_, index) => ({
        id: `hist-${index}`, requestId: `r-hist-${index}`, symbol: '600519.XSHG', side: 'buy', type: 'limit',
        qty: 100, limitPrice: 10, status: 'filled', fillPrice: 10, note: '历史备注'.repeat(20), createdAt: ts(), updatedAt: ts(),
      })))
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('订单'))
      e2e.click(tab)
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.note = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('共 31 条'))
        return node ? node.innerText.trim() : null
      }, 4000)
      result.hasNote = (document.querySelector('.pt-main')?.innerText ?? '').includes('历史备注')
      result.noteWidth = document.querySelector('.pt-main table .pt-note-cell')?.getBoundingClientRect().width ?? null
      window.__fake.on('list/orders', () => window.__pendingOrders ?? stockOrders)
      return result
    }
    if (name === 'stock-reasons') {
      window.__fake.on('list/orders', () => [{
        id: 's-reason', requestId: 'r-s-reason', symbol: '600519.XSHG', side: 'sell', type: 'market',
        qty: 100, status: 'canceled', reason: 'insufficient_position', createdAt: ts(), updatedAt: ts(),
      }])
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('订单'))
      e2e.click(tab)
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.text = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('可卖不足') ? text : null
      }, 4000)
      window.__fake.on('list/orders', () => window.__pendingOrders ?? stockOrders)
      return result
    }
    if (name === 'reset-account') {
      window.confirm = () => true
      const resetAccount = {
        accountId: 'default', currency: 'CNY', initialCash: 1000000, cash: 1000000,
        marketValue: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0,
        tradeDate: '2026-10-22', blocked: false, positions: [], settings: {},
      }
      window.__fake.on('account/get', () => resetAccount)
      window.__fake.on('account/reset', () => resetAccount)
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (tab) e2e.click(tab)
      const reset = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '重置')
      if (reset) e2e.click(reset)
      result.notice = await e2e.wait(() => {
        const text = document.querySelector('.pt-inner')?.innerText ?? ''
        return text.includes('账户已重置') ? text : null
      }, 4000)
      return result
    }
    if (name === 'next-trade-date') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
      const tomorrow = fmt.format(new Date(Date.now() + 86_400_000))
      window.__fake.on('account/get', () => ({
        accountId: 'default', currency: 'CNY', initialCash: 1000000, cash: 1000000,
        marketValue: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0,
        tradeDate: tomorrow, blocked: false, positions: [], settings: {},
      }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.sub = await e2e.wait(() => {
        const text = document.querySelector('.pt-sub')?.innerText ?? ''
        return text.includes('下一交易日') ? text : null
      }, 4000)
      window.__fake.on('account/get', () => window.__baseStockAccount)
      return result
    }
    if (name === 'basket' || name === 'basket-preview') {
      const tab = e2e.byText('一揽子')[0]
      if (!tab) throw new Error('basket tab missing')
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      const csv = '代码,权重\n600519,30%\n000001,20%\n300750,50%\n'
      const transfer = new DataTransfer()
      transfer.items.add(new File([csv], 'basket.csv', { type: 'text/csv' }))
      fileInput.files = transfer.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      result.fileName = await e2e.wait(() => e2e.text('.pt-card').includes('basket.csv') ? 'basket.csv' : null)
      const previewButton = await e2e.wait(() => {
        const button = e2e.byText('预览配股')[0]
        return button && !button.disabled ? button : null
      })
      if (!previewButton) throw new Error('preview button never enabled (csv not read)')
      e2e.click(previewButton)
      result.preview = await e2e.wait(() => {
        const table = [...document.querySelectorAll('.pt-table')].find(el => el.innerText.includes('目标权重'))
        return table ? table.innerText.replace(/\n/g, ' | ') : null
      }, 5000)
      const confirm = await e2e.wait(() => e2e.byText('确认下单')[0])
      result.confirmDisabled = confirm ? confirm.disabled : null
      if (name === 'basket-preview') return result
      // Two clicks in the same task must send one request (ref guard).
      if (confirm && !confirm.disabled) { e2e.click(confirm); e2e.click(confirm) }
      result.result = await e2e.wait(() => {
        const table = [...document.querySelectorAll('.pt-table')].find(el => el.innerText.includes('成交价'))
        return table ? table.innerText.replace(/\n/g, ' | ') : null
      }, 5000)
      result.cashLine = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('成交后现金'))
        return node ? node.innerText : null
      })
      result.firstBatchIds = window.__basketBatchIds.slice()
      // A retry after a lost response must reuse the preview's batchId. The
      // button may still be disabled while the post-place refresh runs.
      const retry = await e2e.wait(() => {
        const button = e2e.byText('确认下单')[0]
        return button && !button.disabled ? button : null
      }, 5000)
      if (retry) {
        e2e.click(retry)
        await e2e.wait(() => window.__basketBatchIds.length >= 2)
      }
      result.batchIds = window.__basketBatchIds.slice()
      return result
    }
    if (name === 'debug-switch') {
      const buttons = [...document.querySelectorAll('.pt-seg button')].map(el => ({ text: el.textContent.trim(), active: el.getAttribute('data-active') }))
      result.buttons = buttons
      const switchButton = e2e.byText('期货')[0]
      result.found = switchButton ? switchButton.outerHTML.slice(0, 120) : null
      if (switchButton) e2e.click(switchButton)
      await new Promise(done => setTimeout(done, 1200))
      result.head = e2e.text('.pt-head')
      result.root = e2e.text('.pt-root').slice(0, 300)
      result.tabs = [...document.querySelectorAll('.pt-tab')].map(el => el.textContent.trim())
      return result
    }
    if (name === 'review-data') {
      window.__fake.on('review/get', () => ({
        equityCurve: [
          { date: '2026-10-20', equity: 100000 },
          { date: '2026-10-21', equity: 98000 },
          { date: '2026-10-22', equity: 101000 },
        ],
        maxDrawdownPct: 0.02, tradeCount: 4, buyCount: 2, sellCount: 2,
        totalFees: 12.34, realizedPnl: -1234.56, days: 2,
      }))
      window.__fake.on('review/daily', () => [
        { date: '2026-10-21', equity: 98000, dayPnl: -2000, fees: 5.2, closeSource: 'daily' },
        { date: '2026-10-22', equity: 101000, dayPnl: 3000, fees: 7.1, closeSource: 'last' },
      ])
      window.__fake.on('cash/flow', () => [
        { ts: '2026-10-21T01:00:00.000Z', type: 'open', amount: 100000, balance: 100000 },
        { ts: '2026-10-21T02:00:00.000Z', type: 'buy', amount: -145050, balance: 0 },
      ])
      window.__fake.on('review/roundtrips', () => [
        { symbol: '600519.XSHG', qty: 100, cost: 1450.5, proceeds: 1400, pnl: -5050, holdingDays: 2 },
      ])
      window.__fake.on('list/trades', () => Array.from({ length: 31 }, (_, index) => ({
        id: `t${index}`, ts: '2026-10-21T03:00:00.000Z', symbol: '600519.XSHG', side: 'sell', qty: 100,
        price: 1400, amountCents: 14000000, feesCents: 500,
      })))
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '复盘')
      e2e.click(tab)
      await e2e.wait(() => document.querySelector('.pt-chart-wrap'))
      // The panel loaded review data on mount (empty); a period switch forces
      // a refetch against the overrides.
      const period = e2e.byText('7天')[0]
      if (period) e2e.click(period)
      await e2e.wait(() => document.querySelector('.pt-chart-wrap svg'))
      result.stats = [...document.querySelectorAll('.pt-stat')].map(item => item.innerText)
      result.chart = Boolean(document.querySelector('.pt-chart-wrap svg'))
      result.tables = [...document.querySelectorAll('.pt-main table')].map(table => table.querySelectorAll('tbody tr').length)
      result.negative = [...document.querySelectorAll('.pt-main td, .pt-main .pt-stat-value')]
        .filter(node => node.className.includes('pt-down')).map(node => node.innerText).slice(0, 3)
      result.initial = e2e.text('.pt-main').includes('初始资金')
      result.turn = e2e.text('.pt-main').includes('按标的')
      result.truncation = [...document.querySelectorAll('.pt-main .pt-note')]
        .map(node => node.innerText).find(text => text.includes('仅显示最近 30 条')) ?? null
      return result
    }
    if (name === 'market-retry') {
      let attempts = 0
      const rows = [
        { symbol: '600519.XSHG', name: '贵州茅台', last: 1450.5, prevClose: 1430, status: 'trading' },
        { symbol: '000001.XSHE', name: '平安银行', last: 11.3, prevClose: 11.4, status: 'trading' },
      ]
      window.__fake.on('market/list', () => {
        attempts += 1
        return attempts === 1 ? { __error: { code: 'INTERNAL', message: '行情源暂时不可用' } } : { state: 'ok', page: 1, quotes: rows }
      })
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      result.error = await e2e.wait(() => document.querySelector('.pt-error')?.innerText ?? null, 4000)
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.rows = await e2e.wait(() => {
        const found = document.querySelectorAll('.pt-main tbody tr').length
        return found === 2 ? found : null
      }, 4000)
      result.errorAfter = document.querySelector('.pt-error')?.innerText ?? null
      return result
    }
    if (name === 'market-adopt') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('行情'))
      e2e.click(tab)
      await e2e.wait(() => document.querySelectorAll('.pt-main tbody tr').length > 0, 4000)
      e2e.click(document.querySelector('.pt-main tbody tr'))
      await new Promise(done => setTimeout(done, 300))
      result.tab = [...document.querySelectorAll('.pt-tab')].find(item => item.getAttribute('data-active') === 'true')?.innerText ?? null
      result.symbol = document.querySelector('.pt-ticket-form input')?.value ?? null
      return result
    }
    if (name === 'market-board') {
      window.__boardCalls = []
      window.__fake.on('market/list', payload => {
        window.__boardCalls.push({ board: payload.board, page: payload.page })
        return { state: 'ok', page: 1, quotes: [{ symbol: payload.board === 'star' ? '688001.SH' : '600519.XSHG', name: payload.board === 'star' ? '华兴源创' : '贵州茅台', last: 10, prevClose: 10, status: 'trading' }] }
      })
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      await e2e.wait(() => (document.querySelector('.pt-main')?.innerText ?? '').includes('全市场'))
      e2e.click(e2e.byText('科创板')[0])
      result.text = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('688001') && text.includes('科创板') ? text : null
      }, 4000)
      result.call = window.__boardCalls.at(-1)
      e2e.click(e2e.byText('主板')[0])
      await e2e.wait(() => (document.querySelector('.pt-main')?.innerText ?? '').includes('600519'))
      window.__fake.on('market/list', payload => ({
        state: 'ok',
        page: payload.page ?? 1,
        quotes: [
          { symbol: '600519.XSHG', name: '贵州茅台', last: 1450.5, prevClose: 1430, status: 'trading' },
          { symbol: '000001.XSHE', name: '平安银行', last: 11.3, prevClose: 11.4, status: 'trading' },
        ],
      }))
      return result
    }
    if (name === 'market-watch') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 100))
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      await e2e.wait(() => document.querySelectorAll('.pt-main tbody tr').length >= 2, 5000)
      const watchOnlyButton = e2e.byText('只看自选')[0]
      if (watchOnlyButton && watchOnlyButton.getAttribute('data-active') === 'true') e2e.click(watchOnlyButton)
      await e2e.wait(() => document.querySelectorAll('.pt-main tbody tr').length === 2)
      result.rows = document.querySelectorAll('.pt-main tbody tr').length
      result.nextDisabled = e2e.byText('下一页')[0]?.disabled
      e2e.click(e2e.byText('☆')[0])
      await e2e.wait(() => window.__watchSymbols?.length === 1)
      result.added = window.__watchSymbols.slice()
      e2e.click(e2e.byText('只看自选')[0])
      await new Promise(done => setTimeout(done, 400))
      result.filteredRows = document.querySelectorAll('.pt-main tbody tr').length
      e2e.click(e2e.byText('★')[0])
      await e2e.wait(() => window.__watchSymbols?.length === 0)
      result.removed = window.__watchSymbols.slice()
      result.calls = (window.__watchCalls ?? []).map(list => list.join(','))
      result.empty = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-empty')].find(el => el.innerText.includes('还没有自选'))
        return node ? node.innerText.trim() : null
      }, 3000)
      return result
    }
    if (name === 'watch-concurrent') {
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      const watchOnlyButton = e2e.byText('只看自选')[0]
      if (watchOnlyButton && watchOnlyButton.getAttribute('data-active') === 'true') e2e.click(watchOnlyButton)
      await e2e.wait(() => document.querySelectorAll('.pt-main tbody tr').length === 2)
      // Slow the write so the second click lands before the first response; a
      // state-only implementation loses the first favourite.
      window.__fake.on('watchlist/set', async payload => {
        await new Promise(done => setTimeout(done, 300))
        window.__watchSymbols = payload.symbols
        return { symbols: payload.symbols }
      })
      const stars = e2e.byText('☆')
      if (stars.length < 2) throw new Error('need two unfollowed rows')
      e2e.click(stars[0])
      await new Promise(done => setTimeout(done, 50))
      const second = e2e.byText('☆')[0]
      if (second) e2e.click(second)
      await new Promise(done => setTimeout(done, 1200))
      result.symbols = window.__watchSymbols ? window.__watchSymbols.slice() : null
      result.rows = [...document.querySelectorAll('.pt-main tbody tr')].map(row => row.innerText)
      result.starCount = e2e.byText('☆').length
      result.watchedCount = e2e.byText('★').length
      return result
    }
    if (name === 'search-race') {
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      const input = await e2e.wait(() => {
        const el = document.querySelector('.pt-main input[placeholder^="代码或名称"]')
        return el && el.type !== 'file' ? el : null
      })
      window.__fake.on('market/search', async payload => {
        const first = payload.query === 'aaa'
        await new Promise(done => setTimeout(done, first ? 300 : 50))
        return [{ symbol: first ? '600519.XSHG' : '000001.XSHE', name: first ? '贵州茅台' : '平安银行' }]
      })
      e2e.setInput(input, 'aaa')
      await new Promise(done => setTimeout(done, 200))
      e2e.click(e2e.byText('搜索')[0])
      await new Promise(done => setTimeout(done, 60))
      e2e.setInput(input, 'bbb')
      e2e.click(e2e.byText('搜索')[0])
      await new Promise(done => setTimeout(done, 600))
      result.hits = e2e.text('.pt-main .pt-card')
      window.__fake.on('market/search', query => (query === '600519' ? [{ symbol: '600519.XSHG', name: '贵州茅台' }] : []))
      return result
    }
    if (name === 'market-pages') {
      const pageRows = page => Array.from({ length: 50 }, (_, index) => ({
        symbol: `600${String((page - 1) * 50 + index).padStart(3, '0')}.XSHG`,
        name: `分页股${(page - 1) * 50 + index}`, last: 10 + index / 100, prevClose: 10,
      }))
      window.__fake.on('market/list', payload => ({ state: 'ok', page: payload.page ?? 1, quotes: pageRows(payload.page ?? 1) }))
      const tab = e2e.byText('行情')[0]
      e2e.click(tab)
      await e2e.wait(() => (document.querySelector('.pt-main')?.innerText ?? '').includes('第 1 页'), 4000)
      e2e.click(e2e.byText('下一页')[0])
      result.page2 = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('第 2 页') ? text : null
      }, 4000)
      result.prevEnabled = e2e.byText('上一页')[0]?.disabled ?? null
      e2e.click(e2e.byText('上一页')[0])
      result.page1 = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('第 1 页') ? text : null
      }, 4000)
      return result
    }
    if (name === 'market-empty-search') {
      const tab = e2e.byText('行情')[0]
      if (!tab) throw new Error('market tab missing')
      e2e.click(tab)
      const input = await e2e.wait(() => {
        const el = document.querySelector('.pt-main input[placeholder^="代码或名称"]')
        return el && el.type !== 'file' ? el : null
      })
      if (!input) throw new Error('market search input missing')
      e2e.setInput(input, 'zzzzzz')
      await new Promise(done => setTimeout(done, 200))
      e2e.click(e2e.byText('搜索')[0])
      result.empty = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-empty')].find(el => el.innerText.includes('没有找到匹配标的'))
        return node ? node.innerText.trim() : null
      }, 4000)
      result.card = e2e.text('.pt-main .pt-card')
      result.value = document.querySelector('.pt-main input[placeholder^="代码或名称"]')?.value
      return result
    }
    if (name === 'basket-race') {
      const tab = e2e.byText('一揽子')[0]
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      if (!fileInput) throw new Error('basket-race: no file input')
      const setFile = async (name, text) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([text], name, { type: 'text/csv' }))
        fileInput.files = transfer.files
        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        await e2e.wait(() => e2e.text('.pt-trade').includes(name))
      }
      const oneRow = {
        symbol: '600519', name: '贵州茅台', weight: 1, targetCents: 10000000, price: 1450.5, qty: 100,
        amountCents: 14505000, feesCents: 3626, actualWeight: 0.145, status: 'ok',
      }
      window.__fake.on('basket/preview', async () => {
        await new Promise(done => setTimeout(done, 300))
        return {
          budgetCents: 100000000, cashCents: 100000000, rows: [oneRow], issues: [], warnings: [],
          totalAmountCents: 14505000, totalFeesCents: 3626, residualCents: 85495000, cashAfterCents: 85495000,
          session: { phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true },
        }
      })
      await setFile('a.csv', '代码,权重\n600519,50%\n000001,50%\n300750,0%')
      await new Promise(done => setTimeout(done, 500))
      const preview = e2e.byText('预览配股')[0]
      if (!preview) throw new Error('preview button missing')
      e2e.click(preview)
      await new Promise(done => setTimeout(done, 60))
      await setFile('b.csv', '代码,权重\n600519,100%')
      await new Promise(done => setTimeout(done, 700))
      result.rows = document.querySelectorAll('.pt-main table tbody tr').length
      result.filename = e2e.text('.pt-trade').includes('b.csv')
      result.confirmDisabled = e2e.byText('确认下单')[0]?.disabled ?? null
      return result
    }
    if (name === 'reset-basket') {
      const tab = e2e.byText('一揽子')[0]
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      if (!fileInput) throw new Error('reset-basket: no file input')
      const lines = ['代码,权重', '600519,60%', '000001,40%']
      const transfer = new DataTransfer()
      transfer.items.add(new File([lines.join('\n')], 'reset.csv', { type: 'text/csv' }))
      fileInput.files = transfer.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await e2e.wait(() => e2e.text('.pt-trade').includes('reset.csv'))
      await new Promise(done => setTimeout(done, 600))
      e2e.click(e2e.byText('预览配股')[0])
      await e2e.wait(() => [...document.querySelectorAll('.pt-main table')].some(table => table.innerText.includes('目标权重')), 5000)
      result.rowsBefore = document.querySelectorAll('.pt-main table tbody tr').length
      window.confirm = () => true
      const reset = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '重置')
      if (reset) e2e.click(reset)
      await e2e.wait(() => (document.querySelector('.pt-inner')?.innerText ?? '').includes('账户已重置'), 4000)
      await new Promise(done => setTimeout(done, 500))
      result.rowsAfter = document.querySelectorAll('.pt-main table tbody tr').length
      result.confirmAfter = e2e.byText('确认下单').length
      return result
    }
    if (name === 'basket-oversize') {
      const tab = e2e.byText('一揽子')[0]
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      if (!fileInput) throw new Error('basket-oversize: no file input')
      const transfer = new DataTransfer()
      transfer.items.add(new File(['x'.repeat(33 * 1024)], 'big.csv', { type: 'text/csv' }))
      fileInput.files = transfer.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      result.error = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-error')].find(el => el.innerText.includes('32 KiB'))
        return node ? node.innerText.trim() : null
      }, 3000)
      return result
    }
    if (name === 'basket-budget') {
      const tab = e2e.byText('一揽子')[0]
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      if (!fileInput) throw new Error('basket-budget: no file input')
      const transfer = new DataTransfer()
      transfer.items.add(new File(['代码,权重\n600519,50%\n000001,50%\n'], 'budget.csv', { type: 'text/csv' }))
      fileInput.files = transfer.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await e2e.wait(() => e2e.text('.pt-trade').includes('budget.csv'))
      const budget = [...document.querySelectorAll('.pt-trade input')].find(input => input.placeholder.includes('默认可用'))
      e2e.setInput(budget, 'abc')
      result.disabled = await e2e.wait(() => {
        const button = e2e.byText('预览配股')[0]
        return button && button.disabled ? button.title : null
      }, 3000)
      result.note = [...document.querySelectorAll('.pt-trade .pt-note')].some(node => node.innerText.includes('预算需为正数'))
      e2e.setInput(budget, '１００００')
      result.budget = budget.value
      e2e.setInput(budget, '')
      return result
    }
    if (name === 'basket-error') {
      const tab = e2e.byText('一揽子')[0]
      if (!tab) throw new Error('basket tab missing')
      e2e.click(tab)
      const fileInput = await e2e.wait(() => document.querySelector('input[type=file]'))
      const lines = ['代码,权重']
      for (let index = 0; index < 21; index += 1) lines.push(`60051${String(index).padStart(1, '0')},1%`)
      const transfer = new DataTransfer()
      transfer.items.add(new File([lines.join('\n')], 'too-many.csv', { type: 'text/csv' }))
      fileInput.files = transfer.files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      // The previous scenario left a 3-row preview; wait until the new file has
      // replaced it, otherwise the button is still enabled by the old CSV.
      // Let file.text() settle and React flush the new csv before clicking;
      // otherwise the handler still closes over the previous (3-row) csv.
      await new Promise(done => setTimeout(done, 600))
      const previewButton = await e2e.wait(() => {
        const button = e2e.byText('预览配股')[0]
        return button && !button.disabled ? button : null
      })
      if (!previewButton) throw new Error('preview button never enabled')
      e2e.click(previewButton)
      result.error = await e2e.wait(() => {
        const node = document.querySelector('.pt-error')
        return node ? node.innerText.trim() : null
      }, 5000)
      result.calls = window.__calls.slice(-6)
      result.card = e2e.text('.pt-trade')
      result.panelAlive = Boolean(document.querySelector('.pt-root'))
      return result
    }
    if (name === 'futures-quote-race') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('futures/quote', async payload => {
        const symbol = payload.symbols[0]
        const copper = symbol.startsWith('CU')
        await new Promise(done => setTimeout(done, copper ? 100 : 500))
        return {
          state: 'ok',
          quotes: [{
            symbol, name: copper ? '沪铜2611' : '螺纹钢2611', last: copper ? 70000 : 3200,
            preSettlement: copper ? 69900 : 3150, marketTs: ts(),
          }],
        }
      })
      const search = document.querySelector('input[placeholder^="合约代码"]')
      e2e.setInput(search, 'rb')
      e2e.click(e2e.byText('搜索')[0])
      const rb = await e2e.wait(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('RB2611.SHFE')), 4000)
      e2e.click(rb)
      await new Promise(done => setTimeout(done, 60))
      e2e.setInput(search, 'cu')
      e2e.click(e2e.byText('搜索')[0])
      const cu = await e2e.wait(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('CU2611.SHFE')), 4000)
      e2e.click(cu)
      await new Promise(done => setTimeout(done, 800))
      result.rail = e2e.text('.pt-futures-rail')
      result.contract = document.querySelector('.pt-ticket-form')?.innerText.slice(0, 80) ?? null
      return result
    }
    if (name === 'stock-insufficient') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('order/preview', (payload) => ({
        ...preview,
        symbol: '600519.XSHG', side: 'buy', type: payload.type ?? 'market', qty: Number(payload.qty) || 1000,
        price: 1318, amountCents: 131800000, commissionCents: 397, stampCents: 0, transferCents: 1318,
        totalFeesCents: 1715, cashAfterCents: -100, availableQty: 0, maxBuyQty: 0,
        quote: { ...quote, last: 1318, marketTs: ts() }, warnings: ['可用资金不足，最多可买 0 股'],
      }))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '1000')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('资金不足') ? button.title : null
      }, 4000)
      return result
    }
    if (name === 'stock-oversell') {
      window.__fake.on('order/preview', (payload) => ({
        ...preview,
        symbol: '600519.XSHG', side: 'sell', type: 'market', qty: Number(payload.qty) || 200,
        price: 1318, amountCents: 26360000, commissionCents: 79, stampCents: 13180, transferCents: 26,
        totalFeesCents: 13285, cashAfterCents: 100000000, availableQty: 100, maxBuyQty: 0,
        quote: { ...quote, last: 1318, marketTs: ts() }, warnings: ['可卖 100 股，超过部分不可卖'],
      }))
      e2e.click(e2e.byText('卖出')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '200')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('可卖不足') ? button.title : null
      }, 4000)
      return result
    }
    if (name === 'stock-limit-band') {
      window.__fake.on('order/preview', (payload) => ({
        ...preview,
        symbol: '600519.XSHG', side: 'buy', type: 'limit', qty: 100,
        price: Number(payload.limitPrice) || 2000, amountCents: 20000000,
        commissionCents: 60, stampCents: 0, transferCents: 200, totalFeesCents: 260,
        cashAfterCents: 50000000, availableQty: 0, maxBuyQty: 0,
        quote: { ...quote, last: 1318, marketTs: ts() },
        priceLimit: { upper: 1600, lower: 1200, ratio: 0.1, source: 'prev-close' },
        warnings: ['价格超出涨跌停范围 1200.00–1600.00'],
      }))
      e2e.click(e2e.byText('买入')[0])
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '100')
      e2e.setInput(inputs[2], '2000')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('涨跌停') ? button.title : null
      }, 4000)
      return result
    }
    if (name === 'stock-no-quote') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      e2e.click(e2e.byText('市价')[0])
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('market/quote', () => ({ state: 'failed', quotes: [], notice: '行情暂不可用' }))
      window.__fake.on('order/preview', (payload) => ({
        symbol: payload.symbol ?? '600000.XSHG', side: payload.side ?? 'buy', type: 'market',
        qty: payload.qty ?? 100, price: 0, amountCents: 0, commissionCents: 0, stampCents: 0,
        transferCents: 0, totalFeesCents: 0, cashAfterCents: 100000000, availableQty: 0, maxBuyQty: 0,
        quote: null, warnings: ['没有可用行情，请填写参考价或改用限价单'],
      }))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[0], '600000')
      e2e.setInput(inputs[1], '100')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('无行情') ? button.title : null
      }, 4000)
      result.preview = e2e.text('.pt-preview-pane')
      return result
    }
    if (name === 'futures-no-quote') {
      const tradeTab = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (tradeTab) e2e.click(tradeTab)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('futures/quote', () => ({ state: 'failed', quotes: [], notice: '行情暂不可用' }))
      window.__fake.on('futures/preview', (payload) => ({
        symbol: payload.symbol ?? 'CU2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1,
        price: 0, multiplier: 5, amountCents: 0, marginCents: 0, feesCents: 0, cashAfterCents: 100000000,
        equityAfter: 100000000, riskRatioAfter: 0, maxOpenQty: 0, availableCloseQty: 0,
        quote: null, session: { phase: 'trading', tradeDate: '2026-10-22', canSubmit: true, canMatch: true },
        warnings: ['没有可用行情，暂不可开仓'],
      }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('等待行情') ? button.title : null
      }, 4000)
      result.preview = await e2e.wait(() => {
        const text = document.querySelector('.pt-preview-pane')?.innerText ?? ''
        return text.includes('没有可用行情') ? text : null
      }, 4000)
      return result
    }
    if (name === 'stock-suspended') {
      window.__fake.on('order/preview', (payload) => ({
        ...preview,
        symbol: '600519.XSHG', side: 'buy', type: 'market', qty: 100,
        price: 1318, amountCents: 13180000, commissionCents: 39, stampCents: 0, transferCents: 13,
        totalFeesCents: 52, cashAfterCents: 80000000, availableQty: 0, maxBuyQty: 0,
        quote: { ...quote, status: 'suspended', last: 1318, marketTs: ts() },
        warnings: ['停牌，暂不可交易'],
      }))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[0], '600519')
      e2e.setInput(inputs[1], '100')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('停牌') ? button.title : null
      }, 4000)
      return result
    }
    if (name === 'stock-auction-close') {
      window.__fake.on('market/status', () => ({ phase: 'auction_close', tradeDate: '2026-10-22', canSubmit: true, canMatch: false }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      await new Promise(done => setTimeout(done, 300))
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '100')
      e2e.setInput(inputs[2], '10.5')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('收盘竞价') ? button.title : null
      }, 4000)
      result.header = e2e.text('.pt-sub')
      window.__fake.on('market/status', () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }))
      return result
    }
    if (name === 'stock-preopen') {
      window.__fake.on('order/preview', (payload) => ({
        ...preview,
        symbol: '600519.XSHG', side: 'buy', type: 'limit', qty: 100, price: 10.5,
        amountCents: 105000, commissionCents: 5, stampCents: 0, transferCents: 1,
        totalFeesCents: 6, cashAfterCents: 90000000, availableQty: 0, maxBuyQty: 900,
        quote: { ...quote, status: 'trading', last: 10.5, marketTs: ts() },
        warnings: [],
      }))
      window.__fake.on('market/status', () => ({ phase: 'pre_open', tradeDate: '2026-10-23', canSubmit: true, canMatch: false }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      await new Promise(done => setTimeout(done, 300))
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '100')
      e2e.setInput(inputs[2], '10.5')
      await new Promise(done => setTimeout(done, 500))
      const submit = document.querySelector('.pt-ticket-submit')
      result.enabled = submit ? !submit.disabled : null
      result.title = submit?.title ?? null
      result.header = e2e.text('.pt-sub')
      window.__fake.on('market/status', () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }))
      return result
    }
    if (name === 'review-race2') {
      window.__remount('none')
      await new Promise(done => setTimeout(done, 600))
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '复盘')
      e2e.click(tab)
      await e2e.wait(() => document.querySelector('.pt-chart-wrap'))
      window.__fake.on('review/get', async payload => {
        const fast = payload.period === '30d'
        await new Promise(done => setTimeout(done, fast ? 50 : 400))
        return {
          equityCurve: [{ date: '2026-10-22', equity: 100000 }],
          maxDrawdownPct: 0, tradeCount: fast ? 30 : 7, buyCount: 0, sellCount: 0,
          totalFees: 0, realizedPnl: 0, days: 0,
        }
      })
      e2e.click(e2e.byText('7 天')[0])
      await new Promise(done => setTimeout(done, 60))
      e2e.click(e2e.byText('30 天')[0])
      await new Promise(done => setTimeout(done, 700))
      result.stats = [...document.querySelectorAll('.pt-stat')].map(item => item.innerText)
      return result
    }
    if (name === 'locked-account') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      const stockTrade = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (stockTrade) e2e.click(stockTrade)
      window.__fake.on('account/get', () => ({
        accountId: 'default', currency: 'CNY', initialCash: 1000000, cash: 1000000,
        marketValue: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0,
        tradeDate: '2026-10-22', blocked: true,
        blockedReason: 'events.jsonl 第 3 行校验失败：未知事件类型',
        ledgerPath: '/tmp/paper-trading/events.jsonl',
        positions: [], settings: {},
      }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.blocked = await e2e.wait(() => {
        const text = document.querySelector('.pt-blocked')?.innerText ?? ''
        return text.length > 0 ? text : null
      }, 4000)
      const submit = document.querySelector('.pt-ticket-submit')
      result.submitDisabled = submit?.disabled ?? null
      result.submitTitle = submit?.title ?? null
      result.exportButton = e2e.byText('导出账本').length
      result.copyButton = e2e.byText('复制路径').length
      return result
    }
    if (name === 'futures-locked') {
      const futuresButton = e2e.byText('期货')[0]
      if (futuresButton) e2e.click(futuresButton)
      await new Promise(done => setTimeout(done, 500))
      const futuresTrade = [...document.querySelectorAll('.pt-tab')].find(tab => tab.innerText === '交易')
      if (futuresTrade) e2e.click(futuresTrade)
      window.__fake.on('futures/account/get', () => ({
        accountId: 'futures', currency: 'CNY', initialCash: 1000000, cash: 1000000,
        margin: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0, riskRatio: 0,
        tradeDate: '2026-10-22', blocked: true,
        blockedReason: 'events.jsonl 第 5 行校验失败：未知事件类型',
        ledgerPath: '/tmp/paper-trading/futures/events.jsonl',
        positions: [], settings: { warnRiskRatio: 0.8, liquidateRiskRatio: 1 },
      }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.blocked = await e2e.wait(() => {
        const text = document.querySelector('.pt-blocked')?.innerText ?? ''
        return text.length > 0 ? text : null
      }, 4000)
      result.exportButton = e2e.byText('导出账本').length
      result.copyButton = e2e.byText('复制路径').length
      const copy = e2e.byText('复制路径')[0]
      if (copy) e2e.click(copy)
      result.copyNotice = await e2e.wait(() => {
        const text = [...document.querySelectorAll('.pt-note')].map(node => node.innerText).find(item => item.includes('账本路径') || item.includes('已复制账本路径'))
        return text ?? null
      }, 3000)
      const submit = document.querySelector('.pt-ticket-submit')
      result.hasTicket = Boolean(submit)
      result.submitDisabled = submit?.disabled ?? null
      result.submitTitle = submit?.title ?? null
      return result
    }
    if (name === 'market-closed') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('行情'))
      e2e.click(tab)
      window.__fake.on('market/status', () => ({ phase: 'closed', tradeDate: '2026-10-22', canSubmit: true, canMatch: false }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.note = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('非交易时段'))
        return node ? node.innerText.trim() : null
      }, 4000)
      window.__fake.on('market/status', () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }))
      return result
    }
    if (name === 'market-auction') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('行情'))
      if (tab) e2e.click(tab)
      window.__fake.on('market/status', () => ({ phase: 'auction_close', tradeDate: '2026-10-22', canSubmit: false, canMatch: false }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.note = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('收盘竞价中'))
        return node ? node.innerText.trim() : null
      }, 4000)
      window.__fake.on('market/status', () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }))
      return result
    }
    if (name === 'market-preopen') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('行情'))
      if (tab) e2e.click(tab)
      window.__fake.on('market/status', () => ({ phase: 'pre_open', tradeDate: '2026-10-23', canSubmit: true, canMatch: false }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.note = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('集合竞价中'))
        return node ? node.innerText.trim() : null
      }, 4000)
      window.__fake.on('market/status', () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }))
      return result
    }
    if (name === 'place-retry') {
      window.__fake.on('account/get', () => window.__baseStockAccount)
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      await new Promise(done => setTimeout(done, 500))
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      const marketType = e2e.byText('市价')[0]
      if (!marketType) throw new Error('place-retry: no 市价; tabs=' + [...document.querySelectorAll('.pt-tab')].map(tab => tab.innerText).join(','))
      e2e.click(marketType)
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[0], '600519')
      e2e.setInput(inputs[1], '100')
      window.__placeIds = []
      let calls = 0
      window.__fake.on('order/place', (payload) => {
        window.__placeIds.push(payload.requestId)
        calls += 1
        if (calls === 1) return { __error: { code: 'INTERNAL', message: '网络中断' } }
        return {
          id: 'o-retry', requestId: payload.requestId, symbol: '600519.XSHG', side: 'buy', type: 'market',
          qty: 100, status: 'filled', fillPrice: 1318.49, feesCents: 514, createdAt: ts(), updatedAt: ts(),
        }
      })
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      if (!submit) throw new Error('place-retry: submit disabled; title=' + (document.querySelector('.pt-ticket-submit')?.title ?? 'none'))
      e2e.click(submit)
      result.failure = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('网络中断') ? text : null
      }, 4000)
      e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('成交') ? text : null
      }, 5000)
      result.ids = window.__placeIds.slice()
      return result
    }
    if (name === 'place-double') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 200))
      e2e.click(e2e.byText('市价')[0])
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '100')
      window.__placeCalls = 0
      window.__fake.on('order/place', async (payload) => {
        window.__placeCalls += 1
        await new Promise(done => setTimeout(done, 200))
        return {
          id: 'o-double', requestId: payload.requestId, symbol: '600519.XSHG', side: 'buy', type: 'market',
          qty: 100, status: 'filled', fillPrice: 1318.49, feesCents: 514, createdAt: ts(), updatedAt: ts(),
        }
      })
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      e2e.click(submit)
      e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('成交') ? text : null
      }, 5000)
      result.calls = window.__placeCalls
      return result
    }
    if (name === 'futures-place-retry') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[0], '1')
      e2e.setInput(inputs[1], '3300')
      window.__futuresPlaceIds = []
      let calls = 0
      window.__fake.on('futures/order', (payload) => {
        window.__futuresPlaceIds.push(payload.requestId)
        calls += 1
        if (calls === 1) return { __error: { code: 'INTERNAL', message: '网络中断' } }
        return {
          id: 'f-retry', requestId: payload.requestId, symbol: payload.draft.symbol, name: '沪铜2611',
          side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3300, status: 'filled',
          fillPrice: 3300, marginCents: 165000, feesCents: 500, createdAt: ts(), updatedAt: ts(),
        }
      })
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      if (!submit) throw new Error('futures-place-retry: submit disabled; title=' + (document.querySelector('.pt-ticket-submit')?.title ?? 'none'))
      e2e.click(submit)
      result.failure = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('网络中断') ? text : null
      }, 4000)
      e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('成交') ? text : null
      }, 5000)
      result.ids = window.__futuresPlaceIds.slice()
      return result
    }
    if (name === 'account-retry') {
      window.__fake.on('account/get', () => ({ __error: { code: 'INTERNAL', message: '账本读取失败' } }))
      window.__remount('fresh')
      result.error = await e2e.wait(() => {
        const text = document.querySelector('.pt-error')?.innerText ?? null
        return text !== null && text.includes('账本读取失败') ? text : null
      }, 4000)
      result.retry = e2e.byText('重试').length
      window.__fake.on('account/get', () => window.__baseStockAccount)
      e2e.click(e2e.byText('重试')[0])
      result.loaded = await e2e.wait(() => {
        const text = document.querySelector('.pt-root')?.innerText ?? ''
        return text.includes('运行中') && text.includes('总资产') ? text : null
      }, 4000)
      return result
    }
    if (name === 'futures-account-retry') {
      window.__fake.on('futures/account/get', () => ({ __error: { code: 'INTERNAL', message: '期货账本读取失败' } }))
      window.__remount('fresh')
      await new Promise(done => setTimeout(done, 800))
      const futuresButton = await e2e.wait(() => e2e.byText('期货')[0] ?? null, 4000)
      if (!futuresButton) throw new Error('futures-account-retry: no futures switch')
      e2e.click(futuresButton)
      result.error = await e2e.wait(() => {
        const text = document.querySelector('.pt-error')?.innerText ?? null
        return text !== null && text.includes('期货账本读取失败') ? text : null
      }, 5000)
      result.retry = e2e.byText('重试').length
      window.__fake.on('futures/account/get', () => futuresState.account)
      e2e.click(e2e.byText('重试')[0])
      result.loaded = await e2e.wait(() => {
        const text = document.querySelector('.pt-root')?.innerText ?? ''
        return text.includes('总权益') && text.includes('运行中') ? text : null
      }, 5000)
      return result
    }
    if (name === 'slot-identity') {
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await new Promise(done => setTimeout(done, 500))
      window.__remount('identity')
      await new Promise(done => setTimeout(done, 600))
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      result.symbol = document.querySelector('.pt-ticket-form input')?.value ?? null
      result.notice = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('已从 K 线选择'))
        return node ? node.innerText.trim() : null
      }, 3000)
      return result
    }
    if (name === 'slot-fallback') {
      window.__remount('empty')
      const stockButton = e2e.byText('股票')[0]
      if (stockButton) e2e.click(stockButton)
      await e2e.wait(() => document.querySelector('.pt-kline-rail'))
      await new Promise(done => setTimeout(done, 500))
      result.loadingHint = e2e.text('.pt-kline-hint')
      // Simulate the real failure: a loading text that disappears, then an
      // empty host. Text must not stop the fallback timer.
      const host = document.querySelector('.dsh-kline-native-host')
      if (host) {
        host.textContent = '加载中…'
        setTimeout(() => { host.textContent = '' }, 900)
      }
      await new Promise(done => setTimeout(done, 7500))
      result.panelAlive = Boolean(document.querySelector('.pt-root'))
      result.chart = Boolean(document.querySelector('.pt-kline-body .pt-chart'))
      result.hint = e2e.text('.pt-kline-hint')
      result.retryButton = Boolean(e2e.byText('重试 K 线')[0])
      window.__remount('none')
      await new Promise(done => setTimeout(done, 500))
      return result
    }
    if (name === 'futures-switch') {
      const switchButton = e2e.byText('期货')[0]
      if (!switchButton) throw new Error('account switch missing')
      e2e.click(switchButton)
      await e2e.wait(() => document.querySelector('.pt-workspace-futures'))
      result.head = await e2e.wait(() => e2e.text('.pt-head').includes('期货 ·') ? e2e.text('.pt-head').replace(/\n/g, ' ') : null)
      result.stats = [...document.querySelectorAll('.pt-stat')].map(el => el.innerText.replace(/\n/g, ' '))
      result.previewText = e2e.text('.pt-preview-pane')
      result.submitTitle = document.querySelector('.pt-ticket-submit')?.title ?? null
      result.meta = e2e.text('.pt-ticket-meta')
      result.tabs = [...document.querySelectorAll('.pt-tab')].map(el => el.textContent.trim())
      return result
    }
    if (name === 'futures-search') {
      const search = e2e.byText('搜索')[0]
      if (!search) throw new Error('search button missing')
      e2e.click(search)
      const hit = await e2e.wait(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('RB2611.SHFE')))
      if (!hit) throw new Error('contract hit missing; calls=' + JSON.stringify(window.__calls.slice(-5)))
      e2e.click(hit)
      result.contract = await e2e.wait(() => e2e.text('.pt-futures-rail').includes('乘数') ? e2e.text('.pt-futures-rail').replace(/\n/g, ' ') : null)
      result.calls = window.__calls.slice(-8)
      return result
    }
    if (name === 'futures-preview') {
      result.quoteLine = e2e.text('.pt-quote')
      result.preview = await e2e.wait(() => {
        const pane = document.querySelector('.pt-preview-pane')
        return pane && pane.innerText.includes('保证金') ? pane.innerText.replace(/\n/g, ' ') : null
      }, 5000)
      result.calls = window.__calls.slice(-8)
      return result
    }
    if (name === 'futures-submit') {
      const submit = document.querySelector('.pt-ticket-submit')
      result.submitLabel = submit ? submit.textContent.trim() : null
      result.submitDisabled = submit ? submit.disabled : null
      if (submit && !submit.disabled) e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const receipt = document.querySelector('.pt-receipt')
        return receipt ? receipt.innerText : null
      }, 5000)
      result.book = await e2e.wait(() => {
        const book = e2e.text('.pt-trade-book')
        return book.includes('RB2611.SHFE') ? book.replace(/\n/g, ' ') : null
      }, 5000)
      result.calls = window.__calls.slice(-10)
      return result
    }
    if (name === 'futures-positions-close') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('持仓'))
      e2e.click(tab)
      await e2e.wait(() => (document.querySelector('.pt-main')?.innerText ?? '').includes('到期日'), 4000)
      const close = await e2e.wait(() => [...document.querySelectorAll('.pt-main button')].find(button => button.innerText === '平仓') ?? null, 4000)
      result.found = Boolean(close)
      if (close) close.click()
      await new Promise(done => setTimeout(done, 500))
      result.tab = [...document.querySelectorAll('.pt-tab')].find(item => item.getAttribute('data-active') === 'true')?.innerText ?? null
      result.direction = [...document.querySelectorAll('.pt-ticket-form .pt-seg button')]
        .find(button => button.getAttribute('data-active') === 'true')?.innerText ?? null
      result.qty = document.querySelector('.pt-ticket-form input')?.value ?? null
      return result
    }
    if (name === 'futures-limit') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      window.__fake.on('futures/order', (payload) => {
        const draft = payload.draft
        return {
          id: 'f-limit', requestId: payload.requestId, symbol: draft.symbol, name: '螺纹钢2611',
          side: draft.side, offset: draft.offset, type: draft.type, qty: draft.qty,
          limitPrice: draft.limitPrice, status: 'pending', createdAt: ts(), updatedAt: ts(),
        }
      })
      e2e.click(e2e.byText('限价')[0])
      await new Promise(done => setTimeout(done, 200))
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '3300')
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000)
      if (!submit) throw new Error('place-retry: submit disabled; title=' + (document.querySelector('.pt-ticket-submit')?.title ?? 'none'))
      e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('挂单') ? text : null
      }, 5000)
      return result
    }
    if (name === 'futures-cancel') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('订单'))
      if (tab) e2e.click(tab)
      const pending = {
        id: 'f-pending', requestId: 'r-f-pending', symbol: 'RB2611.SHFE', name: '螺纹钢2611',
        side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3000,
        status: 'pending', createdAt: ts(), updatedAt: ts(),
      }
      window.__fake.on('futures/orders', () => [pending])
      window.__fake.on('futures/cancel', (payload) => {
        window.__fake.on('futures/orders', () => [])
        return { ...pending, id: payload.orderId, status: 'canceled', reason: '手动撤单' }
      })
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      const cancel = await e2e.wait(() => e2e.byText('撤单')[0] ?? null, 4000)
      if (cancel) e2e.click(cancel)
      result.empty = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('无挂单') ? text : null
      }, 4000)
      return result
    }
    if (name === 'futures-reset') {
      window.confirm = () => true
      const resetAccount = {
        accountId: 'futures', currency: 'CNY', initialCash: 1000000, cash: 1000000,
        margin: 0, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0, riskRatio: 0,
        tradeDate: '2026-10-22', blocked: false, positions: [],
        settings: { warnRiskRatio: 0.8, liquidateRiskRatio: 1 },
      }
      window.__fake.on('futures/account/get', () => resetAccount)
      window.__fake.on('futures/account/reset', () => resetAccount)
      const reset = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '重置')
      if (reset) e2e.click(reset)
      result.notice = await e2e.wait(() => {
        const text = document.querySelector('.pt-inner')?.innerText ?? ''
        return text.includes('期货账户已重置') ? text : null
      }, 4000)
      return result
    }
    if (name === 'futures-limit-band') {
      const trade = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '交易')
      if (trade) e2e.click(trade)
      await new Promise(done => setTimeout(done, 300))
      const payload = {
        symbol: 'CU2611.SHFE', side: 'long', offset: 'open', type: 'limit', qty: 1, price: 3500, multiplier: 5,
        amountCents: 1750000, marginCents: 175000, feesCents: 500, cashAfterCents: 99000000,
        equityAfter: 100000000, riskRatioAfter: 0.01, maxOpenQty: 10, availableCloseQty: 0,
        limit: { symbol: 'CU2611.SHFE', upper: 3400, lower: 3000, source: 'limit' },
        quote: { ...futuresQuote, symbol: 'CU2611.SHFE', last: 3300 },
        session: { phase: 'trading', tradeDate: '2026-10-22', canSubmit: true, canMatch: true },
        warnings: ['价格超出涨跌停区间 3000–3400'],
      }
      window.__fake.on('futures/preview', () => payload)
      const inputs = [...document.querySelectorAll('.pt-ticket-form input')]
      e2e.setInput(inputs[1], '3500')
      result.title = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && button.disabled && button.title.includes('涨跌停') ? button.title : null
      }, 4000)
      window.__fake.on('futures/preview', futuresPreview)
      return result
    }
    if (name === 'futures-preopen') {
      window.__fake.on('futures/status', () => ({ phase: 'pre_open', tradeDate: '2026-10-23', canSubmit: false, canMatch: false, nextBoundary: '2026-10-23T01:00:00.000Z' }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.header = await e2e.wait(() => {
        const text = document.querySelector('.pt-sub')?.innerText ?? ''
        return text.includes('待开盘') ? text : null
      }, 4000)
      window.__fake.on('futures/status', () => futuresStatus)
      return result
    }
    if (name === 'futures-lunch') {
      window.__fake.on('futures/status', () => ({ phase: 'lunch', tradeDate: '2026-10-23', canSubmit: false, canMatch: false, nextBoundary: '2026-10-23T05:30:00.000Z' }))
      const refresh = [...document.querySelectorAll('.pt-head button')].find(button => button.innerText === '刷新')
      if (refresh) e2e.click(refresh)
      result.header = await e2e.wait(() => {
        const text = document.querySelector('.pt-sub')?.innerText ?? ''
        return text.includes('休市') ? text : null
      }, 4000)
      window.__fake.on('futures/status', () => futuresStatus)
      return result
    }
    if (name === 'futures-reasons') {
      window.__fake.on('futures/orders', () => [
        {
          id: 'f-reason', requestId: 'r-f-reason', symbol: 'RB2611.SHFE', name: '螺纹钢2611',
          side: 'long', offset: 'open', type: 'limit', qty: 1, limitPrice: 3000,
          status: 'canceled', reason: 'margin_unavailable', note: '期货备注', createdAt: ts(), updatedAt: ts(),
        },
        {
          id: 'f-reason2', requestId: 'r-f-reason2', symbol: 'RB2611.SHFE', name: '螺纹钢2611',
          side: 'long', offset: 'close', type: 'market', qty: 1,
          status: 'canceled', reason: 'insufficient_position', createdAt: ts(), updatedAt: ts(),
        },
      ])
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText.startsWith('订单'))
      e2e.click(tab)
      result.reason = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('可用资金不足') && text.includes('可平不足') ? text : null
      }, 4000)
      window.__fake.on('futures/orders', () => futuresState.orders)
      return result
    }
    if (name === 'futures-product-label') {
      window.__fake.on('futures/review', () => ({
        equityCurve: [], maxDrawdownPct: 0, tradeCount: 1, openCount: 1, closeCount: 0,
        winCount: 0, lossCount: 0, totalFees: 5, realizedPnl: 0,
        byProduct: [{ product: 'rb', tradeCount: 1, realizedPnl: 0 }],
      }))
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '复盘')
      e2e.click(tab)
      result.text = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('RB') ? text : null
      }, 4000)
      window.__fake.on('futures/review', () => ({ equityCurve: [], maxDrawdownPct: 0, tradeCount: 0, openCount: 0, closeCount: 0, winCount: 0, lossCount: 0, totalFees: 0, realizedPnl: 0, byProduct: [] }))
      return result
    }
    if (name === 'futures-review') {
      const tab = [...document.querySelectorAll('.pt-tab')].find(item => item.innerText === '复盘')
      if (tab) e2e.click(tab)
      result.body = await e2e.wait(() => {
        const text = document.querySelector('.pt-main')?.innerText ?? ''
        return text.includes('分品种统计') ? text : null
      }, 4000)
      window.__fake.on('futures/review', async payload => {
        const fast = payload.period === '30d'
        await new Promise(done => setTimeout(done, fast ? 50 : 400))
        return {
          equityCurve: [], maxDrawdownPct: 0, tradeCount: fast ? 30 : 7,
          openCount: 0, closeCount: 0, winCount: 0, lossCount: 0,
          totalFees: 0, realizedPnl: 0, byProduct: [],
        }
      })
      e2e.click(e2e.byText('7 天')[0])
      await new Promise(done => setTimeout(done, 60))
      e2e.click(e2e.byText('30 天')[0])
      await new Promise(done => setTimeout(done, 700))
      result.stats = [...document.querySelectorAll('.pt-stat')].map(item => item.innerText)
      return result
    }
    if (name === 'futures-close') {
      const closeButton = [...document.querySelectorAll('.pt-trade-book button')].find(button => button.innerText === '平仓')
      result.hasClose = Boolean(closeButton)
      if (closeButton) e2e.click(closeButton)
      await new Promise(done => setTimeout(done, 600))
      result.ticket = e2e.text('.pt-ticket-form')
      result.qty = document.querySelector('.pt-ticket-form input')?.value ?? null
      const submit = await e2e.wait(() => {
        const button = document.querySelector('.pt-ticket-submit')
        return button && !button.disabled ? button : null
      }, 5000).catch(() => null)
      result.submitDisabled = submit === null
      if (submit) e2e.click(submit)
      result.receipt = await e2e.wait(() => {
        const text = document.querySelector('.pt-receipt')?.innerText ?? null
        return text !== null && text.includes('平') ? text : null
      }, 5000)
      return result
    }
    throw new Error('unknown scenario: ' + name)
  }

  function boot() {
    const spec = window.__spec
    if (!spec) throw new Error('client bundle did not call the module loader')
    const exportsObject = spec.factory(id => {
      if (id === 'react') return React
      throw new Error('unexpected require: ' + id)
    })
    const registrations = []
    const ctx = {
      slots: {
        inject: (_name, callback) => { callback(); return () => {} },
        register: (options, component) => { registrations.push({ options, component }); return () => {} },
      },
    }
    exportsObject.apply(ctx)
    const main = registrations.find(item => item.options.name === 'main')
    if (!main) throw new Error('main registration missing')
    window.__mainComponent = main.component
    window.__root = ReactDOM.createRoot(document.getElementById('root'))
    window.__root.render(React.createElement(main.component, { renderSlot: () => null }))
    function IdentitySlot({ onIdentity }) {
      React.useEffect(() => { onIdentity?.('000001', '平安银行') }, [])
      return React.createElement('div', { className: 'dsh-kline-native-host' })
    }
    window.__remount = slotMode => {
      const renderSlot = slotMode === 'empty'
        ? () => React.createElement('div', { className: 'dsh-kline-native-host' })
        : slotMode === 'identity'
          ? (name, props) => React.createElement(IdentitySlot, props)
          : () => null
      const key = slotMode === 'fresh' ? `fresh-${Date.now()}-${Math.random()}` : undefined
      window.__root.render(React.createElement(main.component, { key, renderSlot }))
    }
    window.__registrations = registrations
  }

  window.__ready = false
  const wait = () => {
    if (!window.__spec) { setTimeout(wait, 10); return }
    boot()
    window.__ready = true
  }
  wait()
})()
