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
  assert.match(source, /hasSlot \? null : h\('div', \{ className: 'pt-row'/)
  // K-line identity must not rewrite the ticket when the symbol did not change.
  assert.match(source, /formSymbol\.current/)
  // The ticket has no manual quote/preview buttons any more.
  assert.ok(!source.includes('查行情'), 'the quote button must be gone')
  // An unfinished draft (limit with no price) still shows the price: the
  // ticket falls back to a quote-only request instead of a 0.00 preview.
  assert.ok(source.includes("rpc('market/quote'"), 'an unfinished draft asks for the price alone')
  assert.match(source, /previewBlockReason/)
  assert.match(source, /order\/preview/, 'preview runs automatically')
  assert.match(source, /\}, 300\)/, 'preview is debounced by 300 ms')
  assert.match(source, /输入 6 位代码后自动计算/)
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
  assert.match(css, /\.pt-kline-rail \{[^}]*position:sticky/)
  assert.match(css, /\.pt-kline-body \{[^}]*clamp\(420px/)
  assert.match(css, /\.pt-table-wrap \{ overflow-x:auto/)
  assert.match(css, /\.pt-btn\[data-active="true"\]/, 'selected board/watch/period buttons need visible state')
  // Breakpoints follow the panel width (container queries), not the window.
  assert.match(css, /\.pt-root \{[^}]*container:paper-panel \/ inline-size/)
  assert.match(css, /\.pt-main \{[^}]*container:paper-main \/ inline-size/)
  for (const [name, width] of [['paper-main', '760px'], ['paper-panel', '1100px'], ['paper-panel', '760px'], ['paper-panel', '520px']]) {
    assert.ok(css.includes(`@container ${name} (max-width: ${width})`), `missing ${name} breakpoint ${width}`)
  }
})
