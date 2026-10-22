/* Fake RPC backend + mount + scenarios for the UI harness. Runs in the page. */
(function () {
  const ts = () => new Date().toISOString()
  const stockAccount = {
    accountId: 'default', currency: 'CNY', initialCash: 1000000, cash: 985000,
    marketValue: 15000, equity: 1000000, pnl: 0, pnlPct: 0, todayPnl: 0,
    tradeDate: '2026-10-22', blocked: false, positions: [], settings: {},
  }
  const quote = { symbol: '600519.XSHG', name: '贵州茅台', last: 1450.5, prevClose: 1440, marketTs: ts(), source: 'fake' }
  const preview = {
    symbol: '600519.XSHG', side: 'buy', type: 'market', qty: 100, price: 1450.5,
    amountCents: 14505000, commissionCents: 500, stampCents: 0, transferCents: 14,
    totalFeesCents: 514, cashAfterCents: 98500000 - 14505000 - 514, availableQty: 0, maxBuyQty: 600,
    quote, warnings: [],
  }
  const stockOrders = []
  const stockTrades = []

  // --- futures fake state ---------------------------------------------------
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
    const price = 3200
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
      maxOpenQty: 28, availableCloseQty: 0,
      limit: { symbol: draft.symbol, upper: 3400, lower: 2900, ratio: 0.1, source: 'limit' },
      quote: futuresQuote, session: futuresStatus, warnings: [],
    }
  }

  const handlers = {
    'account/get': () => stockAccount,
    'list/orders': () => stockOrders,
    'list/trades': () => stockTrades,
    'review/get': () => ({ equityCurve: [], maxDrawdownPct: 0, tradeCount: 0, buyCount: 0, sellCount: 0, totalFees: 0, realizedPnl: 0, days: 0 }),
    'market/status': () => ({ phase: 'continuous_am', tradeDate: '2026-10-22', canSubmit: true, canMatch: true }),
    'review/daily': () => [],
    'cash/flow': () => [],
    'review/roundtrips': () => [],
    'market/bars': () => ({ state: 'ok', bars: Array.from({ length: 30 }, (_, i) => ({ time: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`, open: 1400 + i, high: 1420 + i, low: 1380 + i, close: 1410 + i })) }),
    'market/quote': () => ({ state: 'ok', quotes: [quote] }),
    'order/preview': () => preview,
    'order/place': () => ({ id: 'o-1', requestId: 'r-1', symbol: '600519.XSHG', side: 'buy', type: 'market', qty: 100, status: 'filled', createdAt: ts(), updatedAt: ts() }),
    'tick': () => ({ tradeDate: '2026-10-22', filled: [], expired: [], notices: [], quotes: [] }),
    'watchlist/get': () => ({ symbols: [] }),
    'watchlist/set': payload => ({ symbols: payload.symbols }),

    // --- basket -------------------------------------------------------------
    'basket/preview': (payload) => {
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
    'futures/contracts': () => ({ state: 'ok', contracts: [futuresContract] }),
    'futures/quote': () => ({ state: 'ok', quotes: [futuresQuote] }),
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

  window.__calls = []
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
      result.ticketFields = [...document.querySelectorAll('.pt-ticket-form > *')].map(el => el.className)
      result.book = e2e.text('.pt-trade-book').replace(/\n/g, ' ')
      result.kline = Boolean(document.querySelector('.pt-kline-body'))
      return result
    }
    if (name === 'basket') {
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
      if (confirm && !confirm.disabled) e2e.click(confirm)
      result.result = await e2e.wait(() => {
        const table = [...document.querySelectorAll('.pt-table')].find(el => el.innerText.includes('成交价'))
        return table ? table.innerText.replace(/\n/g, ' | ') : null
      }, 5000)
      result.cashLine = await e2e.wait(() => {
        const node = [...document.querySelectorAll('.pt-note')].find(el => el.innerText.includes('成交后现金'))
        return node ? node.innerText : null
      })
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
    if (name === 'futures-switch') {
      const switchButton = e2e.byText('期货')[0]
      if (!switchButton) throw new Error('account switch missing')
      e2e.click(switchButton)
      await e2e.wait(() => document.querySelector('.pt-workspace-futures'))
      result.head = await e2e.wait(() => e2e.text('.pt-head').includes('期货 ·') ? e2e.text('.pt-head').replace(/\n/g, ' ') : null)
      result.stats = [...document.querySelectorAll('.pt-stat')].map(el => el.innerText.replace(/\n/g, ' '))
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
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(main.component, { renderSlot: () => null }))
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
