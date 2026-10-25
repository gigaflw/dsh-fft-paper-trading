import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/** Execute the browser bundle with a captured ModuleLoader call and a minimal React. */
function loadClient() {
  let captured
  const fakeWindow = { __ModuleLoader__: { load: spec => { captured = spec } } }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
  }
  new Function('window', 'require', source)(fakeWindow, id => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  assert.ok(captured, 'module loader was not called')
  return captured
}

test('browser bundle: factory loads and registers the sidebar panel', () => {
  const spec = loadClient()
  assert.equal(spec.id, '@ft/dsh-fft-paper-trading')

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: value => [value, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
  }
  const exportsObject = spec.factory(id => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  assert.equal(typeof exportsObject.apply, 'function')

  const registrations = []
  const ctx = {
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  exportsObject.apply(ctx)

  const panellist = registrations.find(item => item.options.name === 'sidebar.panellist')
  const main = registrations.find(item => item.options.name === 'main')
  assert.ok(panellist, 'sidebar entry missing')
  assert.equal(panellist.options.id, 'ft-paper-trading')
  assert.ok(main, 'main panel missing')
  assert.equal(main.options.key, 'ft-paper-trading')
  assert.deepEqual(main.options.children, {
    'paperTrading.kline': { kind: 'single', scope: 'root' },
  })
  assert.match(source, /market\/status/)
  assert.match(source, /review\/daily/)
  assert.match(source, /paperTrading\.kline/)
  assert.match(source, /account\/export/, 'the locked banner needs an export entry point')
  // The locked banner must name the failure and the file, not just "locked".
  assert.match(source, /account\.blockedReason/)
  assert.match(source, /account\.ledgerPath/)
  assert.match(source, /复制路径/)
  // Times are pinned to zh-CN / Asia/Shanghai, never the host locale.
  assert.match(source, /Intl\.DateTimeFormat\('zh-CN'/)
  assert.match(source, /Asia\/Shanghai/)
  assert.match(source, /CANCEL_REASON_TEXT/)
  assert.match(source, /ERROR_TEXT/)
  // The fake day/minute buttons only exist when the K-line slot is absent.
  assert.match(source, /showFallback \? h\('div', \{ className: 'pt-row'/)
  // K-line identity must not rewrite the ticket when the symbol did not change.
  assert.match(source, /formSymbol\.current/)
  // Every code the panel shows is the host's canonical `code.exchange` id.
  assert.match(source, /const symbolText = quote => \[quote\?\.symbol, quote\?\.name\]/)
  // dsh_kline's own suffixes are folded to canonical ids before they reach the ticket.
  assert.match(source, /XSHG: 'SH'/)
  assert.match(source, /foldHostSymbol/)
  assert.ok(!source.includes('bareSymbol('), 'display must not strip the exchange suffix')
  // The stock preview effect must use the standalone quote state, not a
  // removed `setQuote` (which threw a ReferenceError on an unfinished draft).
  // The browser e2e renders a short symbol to cover the runtime path.
  assert.match(source, /const \[symbolQuote, setSymbolQuote\] = useState\(null\)/)
  // A limit order without a limit price is blocked before hitting the host.
  assert.ok(source.match(/if \(form\.type === 'limit' && !\(Number\(form\.limitPrice\) > 0\)\) return '填写限价'/g).length >= 2, 'stock and futures tickets both block an empty limit price')
  // The ticket has no manual quote/preview buttons any more.
  assert.ok(!source.includes('查行情'), 'the quote button must be gone')
  // An unfinished draft (limit with no price) still shows the price: the
  // ticket falls back to a quote-only request instead of a 0.00 preview.
  assert.ok(source.includes("rpc('market/quote'"), 'an unfinished draft asks for the price alone')
  assert.match(source, /previewBlockReason/)
  assert.match(source, /searchHits, searchAttempted/)
  assert.ok(!source.includes("'状态', ''"), 'tables must label the action column')
  assert.match(source, /K 线视图未加载/)
  assert.match(source, /amountFormat/)
  assert.match(source, /order\/preview/, 'preview runs automatically')
  assert.match(source, /\}, 300\)/, 'preview is debounced by 300 ms')
  assert.match(source, /输入代码后自动计算/)
  assert.match(source, /计算中…/)
  // The post-submit receipt is rendered from the fill record.
  assert.match(source, /function ReceiptLine/)
  assert.match(source, /receipt\.failure/)
  assert.match(source, /成交后现金/)
  const glyph = panellist.component({ size: 16 })
  assert.ok(glyph, 'glyph did not render')
})

test('browser bundle: the page surface fills the column, only the content is capped', () => {
  const start = source.indexOf('const CSS = `')
  const css = source.slice(start, source.indexOf('\n    `', start))
  const root = /\.pt-root \{[^}]*\}/.exec(css)
  assert.ok(root, 'page surface rule missing')
  assert.ok(!root[0].includes('max-width'), 'the surface must not cap its own width')
  const inner = /\.pt-inner \{[^}]*\}/.exec(css)
  assert.ok(inner, 'inner layout rule missing')
  assert.ok(!inner[0].includes('max-width'), 'the inner column must use the full width')
  assert.match(css, /\.pt-workspace \{[^}]*grid-template-columns/)
  // The K-line rail sets the row height, so the left column fills the same
  // bottom edge instead of leaving an empty bottom-left corner.
  assert.match(css, /\.pt-workspace \{[^}]*align-items:stretch/)
  assert.match(css, /\.pt-tab-body \{[^}]*flex:1 1 auto/)
  assert.match(css, /\.pt-trade-book \{[^}]*flex:1 1 auto/)
  // One ticket card: an aligned two-column form grid plus an in-card preview.
  assert.match(css, /\.pt-ticket \{[^}]*grid-template-columns:minmax\(0, 1fr\) minmax\(230px, 300px\)/)
  assert.match(css, /\.pt-ticket-form \{[^}]*grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(source, /function TradeBook/)
  assert.ok(!source.includes('pt-trade-grid'), 'the loose two-card trade grid must be gone')
  assert.match(css, /\.pt-kline-rail \{[^}]*position:sticky/)
  assert.match(css, /\.pt-kline-body \{[^}]*clamp\(420px/)
  assert.match(css, /\.pt-table-wrap \{ overflow-x:auto/)
  assert.match(css, /\.pt-btn\[data-active="true"\]/, 'selected board/watch/period buttons need visible state')
  // A selected segment is state, not action: it keeps the soft tint so the only
  // solid orange on a page is the submit button.
  assert.match(css, /\.pt-seg button\[data-active="true"\] \{[^}]*background:var\(--pt-accent-soft\)/)
  assert.ok(!/\.pt-seg button\[data-active="true"\] \{[^}]*background:var\(--pt-accent\)/.test(css), 'a segment must not fill with the solid accent')
  // Direction reads before quantity and shares one half-width row with it.
  assert.match(css, /\.pt-field-pair \{[^}]*grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(source, /className: 'pt-span-2 pt-field-pair'[\s\S]{0,200}label: '方向'[\s\S]{0,400}数量（100 股整数倍）/)
  // Breakpoints follow the panel width (container queries), not the window.
  assert.match(css, /\.pt-root \{[^}]*container:paper-panel \/ inline-size/)
  assert.match(css, /\.pt-main \{[^}]*container:paper-main \/ inline-size/)
  for (const [name, width] of [['paper-main', '640px'], ['paper-panel', '1100px'], ['paper-panel', '760px'], ['paper-panel', '520px']]) {
    assert.ok(css.includes(`@container ${name} (max-width: ${width})`), `missing ${name} breakpoint ${width}`)
  }
})

/** Source slice between two markers, used to keep each feature scope honest. */
function sliceBetween(from, to) {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `missing marker: ${from}`)
  const end = source.indexOf(to, start + from.length)
  assert.ok(end > start, `missing marker: ${to}`)
  return source.slice(start, end)
}

test('browser bundle: the basket tab imports a CSV and places the previewed rows', () => {
  assert.match(source, /function BasketTab/, 'the basket tab is a component of its own')
  // It follows the single-order ticket in the stock tab strip.
  assert.match(source, /\[\['trade', '交易'\], \['basket', '批量'\]/, 'the basket tab sits right after the ticket')
  assert.match(source, /basket\/preview/)
  assert.match(source, /basket\/place/)
  // The picker accepts CSV only and the browser half reads the file itself.
  assert.match(source, /accept: '\.csv,text\/csv'/)
  assert.match(source, /file\.text\(\)/, 'files are read with the File API, no CSV dependency')
  assert.match(source, /crypto\.randomUUID/, 'the client generates the batch id for idempotent retries')
  assert.match(source, /batchId: id, rows/, 'place receives the frozen preview batch id and the previewed rows')
  // Preview columns and the status vocabulary stay user-facing.
  for (const label of ['代码', '名称', '目标权重', '目标金额', '股数', '金额', '费用', '实际权重', '状态']) {
    assert.ok(source.includes(`'${label}'`), `missing basket column ${label}`)
  }
  for (const text of ['可买', '不足 1 手', '无行情', '停牌']) {
    assert.ok(source.includes(text), `missing basket status ${text}`)
  }
  for (const label of ['合计金额', '剩余现金', '成交后现金', '费用']) {
    assert.ok(source.includes(label), `missing basket summary ${label}`)
  }
  // Confirm is gated by the session, the account and the preview, not by a failed quote.
  assert.match(source, /preview\.session\.canMatch === false/)
  assert.match(source, /没有可下单的行/)
  // Row-level issues and host warnings are shown compactly, never as prose.
  assert.match(source, /preview\.issues/)
  assert.match(source, /preview\.warnings/)
  assert.match(source, /BASKET_STATUS_TEXT/)
})

test('browser bundle: futures account switch, four tabs and the futures endpoints', () => {
  assert.match(source, /function AccountSwitch/)
  assert.match(source, /\['stock', '股票'\]/)
  assert.match(source, /\['futures', '期货'\]/)
  assert.match(source, /function FuturesDashboard/)
  assert.match(source, /accountMode === 'futures'/)
  // The futures half talks to the futures endpoints only.
  for (const endpoint of [
    'futures/account/get', 'futures/account/reset', 'futures/account/export',
    'futures/contracts', 'futures/quote', 'futures/status', 'futures/preview',
    'futures/order', 'futures/cancel', 'futures/positions', 'futures/orders',
    'futures/review', 'futures/tick',
  ]) {
    assert.ok(source.includes(`'${endpoint}'`), `missing endpoint ${endpoint}`)
  }
  // Four wallet tabs: no futures market page and no futures K-line.
  assert.match(source, /FUTURES_TABS = \['trade', 'positions', 'orders', 'review'\]/)
  const futuresScope = sliceBetween('function FuturesDashboard', 'function StockDashboard')
  assert.ok(!futuresScope.includes('KlinePane'), 'the futures half must not render a K-line')
  assert.ok(!futuresScope.includes('setSymbolQuote'), 'the futures half must not touch the stock quote state')
  assert.ok(!futuresScope.includes("'market', '行情'"), 'the futures half must not render a market page')
  // Futures vocabulary and ticket gates.
  for (const text of ['开多', '开空', '平多', '平空', '手数', '风险度', '保证金占用', '涨停', '跌停', '平仓']) {
    assert.ok(futuresScope.includes(text), `missing futures copy ${text}`)
  }
  assert.match(source, /var\(--dsw-alias-state-warn-primary/)
  assert.match(source, /\.pt-workspace-futures/)
  assert.match(source, /function FuturesContractRail/)
  // Futures polling ticks the futures account, never the stock matcher.
  assert.match(source, /rpc\('futures\/tick'\)/)
  // Reset asks for the right account and the header keeps the stock switch.
  assert.match(source, /重置期货模拟账户/)
  const stockHeader = sliceBetween('function StockDashboard', 'const PANEL_ID')
  assert.match(stockHeader, /accountSwitch/)
  assert.ok(stockHeader.includes("['market', '行情']"), 'the stock market tab must stay')
})

test('browser bundle: inline 资金 panel moves cash on both accounts', () => {
  assert.match(source, /function CashMovePanel/)
  assert.match(source, /'注资'/)
  assert.match(source, /'提款'/)
  assert.match(source, /确认注资/)
  assert.match(source, /确认提款/)
  assert.match(source, /可提 /)
  assert.match(source, /CASH_QUICK_AMOUNTS/)
  assert.match(source, /netCashFlow/)
  // The panel never promises to edit the total: money moves in or out.
  for (const endpoint of ['account/deposit', 'account/withdraw', 'futures/account/deposit', 'futures/account/withdraw']) {
    assert.ok(source.includes(`'${endpoint}'`), `missing endpoint ${endpoint}`)
  }
  assert.ok(source.includes("'资金'"), 'the header must expose the cash button')
  // Futures review lists the cash moves, not just the equity curve.
  assert.match(source, /futures\/cash\/flow/)
  assert.match(source, /FUTURES_CASH_TYPE_TEXT/)
  assert.match(source, /\.pt-cash \{/)
})

test('browser bundle: header badge carries the four data-source states', () => {
  for (const text of ['数据源已配置', '免费数据源', '无数据源', '数据源无效']) {
    assert.ok(source.includes(`'${text}'`), `missing badge copy: ${text}`)
  }
  assert.match(source, /function DataSourceBadge/)
  assert.match(source, /\.pt-source \{/)
  assert.match(source, /\.pt-source\[data-state="configured"\] \.pt-source-dot/)
  assert.match(source, /\.pt-source\[data-state="invalid"\] \.pt-source-dot/)
  // Both dashboards refresh the badge inside the account bundle they already poll.
  assert.equal(source.match(/rpc\('market\/data-source'\)/g).length, 2)
})
