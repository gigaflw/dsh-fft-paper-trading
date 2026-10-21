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
  const glyph = panellist.component({ size: 16 })
  assert.ok(glyph, 'glyph did not render')
})

test('browser bundle: the page surface fills the column, only the content is capped', () => {
  const start = source.indexOf('const CSS = `')
  const css = source.slice(start, source.indexOf('\n    `', start))
  const root = /\.pt-root \{[^}]*\}/.exec(css)
  assert.ok(root, 'page surface rule missing')
  assert.ok(!root[0].includes('max-width'), 'the surface must not cap its own width')
  assert.match(css, /\.pt-inner \{[^}]*max-width:1080px/)
  assert.match(css, /\.pt-table-wrap \{ overflow-x:auto/)
  // Breakpoints follow the panel width (container queries), not the window.
  for (const width of ['900px', '760px', '520px']) {
    assert.ok(css.includes(`@container (max-width: ${width})`), `missing container breakpoint ${width}`)
  }
})
