/**
 * Deterministic end-to-end harness for the golden (characterization) suite.
 *
 * The suite exists to freeze observable behavior before the stock/futures
 * consolidation refactor: it wires the real plugin (`apply`) with a frozen
 * clock and deterministic data ports, then talks to the real HTTP route and the
 * real agent tools. Only the host boundary (connection/tools/logger) and the
 * market data upstream are faked; ledger files are real JSONL on disk.
 *
 * Refactors must keep every golden byte-identical. Deliberate behavior changes
 * are made explicit by regenerating the affected golden with `GOLDEN_UPDATE=1`.
 */
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../../lib/index.js'

const ROUTE = 'http://127.0.0.1/api/ft-paper-trading'

/** Mutable clock shared by the registry, both services and the fake ports. */
export function createClock(start = '2026-11-16T10:00:00+08:00') {
  let ms = Date.parse(start)
  return {
    now: () => new Date(ms),
    iso: () => new Date(ms).toISOString(),
    set(iso) {
      ms = Date.parse(iso)
    },
    advance(seconds) {
      ms += seconds * 1000
    },
  }
}

const STOCK_SYMBOLS = {
  '600519.SH': { name: '贵州茅台', last: 1450.5, prevClose: 1440, close: 1455.5 },
  '000001.SZ': { name: '平安银行', last: 11.3, prevClose: 11.2, close: 11.35 },
}

const bar = (date, open, close) => ({ time: `${date}T15:00:00+08:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 })

/** A frozen market: quotes move only when the scenario says so. */
function stockPort(clock) {
  const prices = new Map(Object.entries(STOCK_SYMBOLS).map(([symbol, row]) => [symbol, { ...row }]))
  const bars = symbol => {
    const row = prices.get(symbol)
    if (row === undefined) return []
    return [bar('2026-11-13', 1438, 1440), bar('2026-11-16', 1442, row.close)]
  }
  return {
    prices,
    async quotes(symbols) {
      const quotes = symbols.filter(symbol => prices.has(symbol)).map(symbol => ({
        symbol,
        name: prices.get(symbol).name,
        last: prices.get(symbol).last,
        prevClose: prices.get(symbol).prevClose,
        marketTs: clock.iso(),
        fetchedAt: clock.iso(),
        source: 'fake',
      }))
      return { state: quotes.length === 0 ? 'failed' : 'ok', quotes }
    },
    async dailyBars(symbol) {
      return { state: 'ok', bars: bars(symbol) }
    },
    async minuteBars() {
      return { state: 'ok', bars: [] }
    },
    async search(query) {
      const symbol = String(query).trim()
      const row = prices.get(symbol)
      return row === undefined ? [] : [{ symbol, name: row.name }]
    },
    async marketList() {
      return { state: 'ok', quotes: [], page: 1 }
    },
  }
}

const RB = 'RB2611.SHFE'
const FUTURES_SYMBOLS = {
  [RB]: { name: '螺纹钢2611', last: 3200, preSettlement: 3150 },
}

/** A frozen futures market with one contract, stable margin and fees. */
function futuresPort(clock) {
  const prices = new Map(Object.entries(FUTURES_SYMBOLS).map(([symbol, row]) => [symbol, { ...row }]))
  return {
    prices,
    async contracts() {
      return {
        state: 'ok',
        value: [{
          symbol: RB, name: '螺纹钢2611', product: 'rb', exchange: 'SHFE',
          multiplier: 10, tickSize: 1, marginRate: 0.1, deListDate: '2027-01-15',
          tradeHours: '上午9:00-11:30,下午13:30-15:00,下午21:00-23:00(夜盘)',
        }],
      }
    },
    async quotes(symbols) {
      return {
        state: 'ok',
        value: symbols.filter(symbol => prices.has(symbol)).map(symbol => ({
          symbol,
          last: prices.get(symbol).last,
          preSettlement: prices.get(symbol).preSettlement,
          volume: 1000,
          openInterest: 5000,
          marketTs: clock.iso(),
          tradeDate: '2026-11-16',
        })),
      }
    },
    async limits(symbols) {
      return {
        state: 'ok',
        value: symbols.map(symbol => ({ symbol, upper: 3400, lower: 2900, marginRate: 0.1, source: 'limit' })),
      }
    },
    async settle(symbols) {
      return {
        state: 'ok',
        value: symbols.map(symbol => ({ symbol, settle: 3200, longMarginRate: 0.1, feePerLotCents: 500 })),
      }
    },
    async closes(symbols, date) {
      return {
        state: 'ok',
        value: symbols.map(symbol => ({ symbol, close: prices.get(symbol)?.last ?? 3200, tradeDate: date ?? '2026-11-16', source: 'daily' })),
      }
    },
  }
}

/** Fake Cordis context: only the inject names the plugin actually asks for. */
function createContext() {
  const tools = new Map()
  const routes = []
  const effects = []
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
    inject(dependencies, callback) {
      if (dependencies.includes('connection')) {
        callback({
          get: () => ({ fetch: { register: route => { routes.push(route); return async () => {} } } }),
          effect: fn => { fn(); return () => {} },
        })
      } else if (dependencies.includes('tools')) {
        callback({ get: () => ({ register: tool => tools.set(tool.name, tool) }) })
      }
      return undefined
    },
  }
  return { ctx, tools, routes, effects }
}

/**
 * Build one isolated world in a scratch `$DSH_HOME`.
 *
 * @param {object} [options]
 * @param {string} [options.start] frozen wall clock
 * @param {string} [options.name] scratch directory label
 */
export async function createWorld(options = {}) {
  const name = options.name ?? 'golden'
  const home = join(process.cwd(), 'build', 'golden', `${name}-${process.pid}-${Date.now()}`)
  await mkdir(home, { recursive: true })
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const clock = createClock(options.start)
  const stock = stockPort(clock)
  const futures = futuresPort(clock)
  const { ctx, tools, routes, effects } = createContext()
  apply(ctx, { now: clock.now, marketData: stock, futuresMarketData: futures })
  if (routes.length !== 1) throw new Error(`expected one route, got ${routes.length}`)

  const post = async body => {
    const response = await routes[0].fetch(new Request(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    if (response.status !== 200) throw new Error(`route status ${response.status}`)
    return response.json()
  }

  return {
    home,
    clock,
    tools,
    /** Fake upstream prices, mutable inside a scenario (a tick moves the market). */
    stock,
    futures,
    /** Call one RPC endpoint; the account field is optional. */
    async call(endpoint, payload = {}, account) {
      return post({ endpoint, payload, ...(account === undefined ? {} : { account }) })
    },
    /** Execute one registered agent tool exactly as the model would. */
    async tool(name, args = {}) {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`unknown tool ${name}`)
      return tool.execute(args)
    },
    async dispose() {
      for (const dispose of effects) await dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    },
  }
}

/** Recursively normalize volatile values so goldens diff on behavior alone. */
export function makeNormalizer(home) {
  const ids = new Map()
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  const accountId = /\bacc-[a-z0-9]+\b/g
  const mapId = match => {
    if (!ids.has(match)) ids.set(match, `<id${ids.size + 1}>`)
    return ids.get(match)
  }
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  // Account ids are random and also appear as store keys, so keys take the
  // same mapping; first-seen order comes from the scenario steps, which are
  // deterministic.
  const normalizeKey = name => (/^acc-[a-z0-9]+$/.test(name) ? mapId(name) : name)
  const normalize = (value, key = '') => {
    if (typeof value === 'string') {
      // File-system times are the only nondeterministic values in the world.
      if (key === 'updatedAt' || key === 'createdAt') return '<mtime>'
      const text = value
        .split(home).join('<home>')
        .replace(uuid, '<uuid>')
        .replace(accountId, mapId)
      return iso.test(text) ? '<ts>' : text
    }
    if (Array.isArray(value)) return value.map(item => normalize(item))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [normalizeKey(name), normalize(item, name)]))
    }
    return value
  }
  return normalize
}

/**
 * Read the on-disk truth: registry, every ledger's event stream and the file
 * tree. `events.jsonl` is the audit trail a refactor must not reorder or change.
 */
export async function captureStore(home, normalize) {
  const root = join(home, 'paper-trading')
  const tree = {}
  const ledgers = {}
  let entries = []
  try {
    entries = await readdir(root)
  } catch {
    entries = []
  }
  for (const entry of entries.sort()) {
    const path = join(root, entry)
    const info = await stat(path).catch(() => undefined)
    if (info === undefined) continue
    if (info.isDirectory()) {
      const files = (await readdir(path)).sort()
      tree[normalize(entry)] = files
      if (files.includes('events.jsonl')) {
        const lines = (await readFile(join(path, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean)
        ledgers[normalize(entry)] = lines.map(line => {
          const event = JSON.parse(line)
          return normalize({ seq: event.seq, type: event.type, payload: event.payload })
        })
      }
    } else if (entry.endsWith('.json')) {
      tree[entry] = [entry]
      ledgers[entry] = normalize(JSON.parse(await readFile(path, 'utf8')))
    }
  }
  return { tree, ledgers }
}

/**
 * Compare (or regenerate) one golden file. On mismatch the assertion shows the
 * first differing path so a refactor failure points at the step that changed.
 */
/** First differing path, so a mismatch names the field instead of dumping pages. */
function firstDiff(actual, expected, path = '') {
  if (actual === expected) return undefined
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    return { path, actual, expected }
  }
  if (typeof actual !== 'object') return { path, actual, expected }
  if (Array.isArray(actual) !== Array.isArray(expected)) return { path, actual, expected }
  if (Array.isArray(actual)) {
    if (actual.length !== expected.length) return { path, actual: actual.length, expected: expected.length }
    for (let index = 0; index < actual.length; index += 1) {
      const diff = firstDiff(actual[index], expected[index], `${path}[${index}]`)
      if (diff !== undefined) return diff
    }
    return undefined
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const key of keys) {
    if (!(key in actual)) return { path: `${path}.${key}`, actual: '<missing>', expected: expected[key] }
    if (!(key in expected)) return { path: `${path}.${key}`, actual: actual[key], expected: '<missing>' }
    const diff = firstDiff(actual[key], expected[key], `${path}.${key}`)
    if (diff !== undefined) return diff
  }
  return undefined
}

export async function checkGolden(name, actual) {
  const file = join(process.cwd(), 'tests', 'golden', `${name}.json`)
  if (process.env.GOLDEN_UPDATE === '1') {
    await writeFile(file, `${JSON.stringify(actual, null, 2)}\n`, 'utf8')
    return { updated: true }
  }
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined) throw new Error(`missing golden ${file}; run GOLDEN_UPDATE=1`)
  const expected = JSON.parse(text)
  const diff = firstDiff(actual, expected)
  if (diff !== undefined) {
    assert.fail(`${name}: behavior changed at ${diff.path}\n  golden: ${JSON.stringify(diff.expected).slice(0, 400)}\n  actual: ${JSON.stringify(diff.actual).slice(0, 400)}`)
  }
  return { updated: false }
}
