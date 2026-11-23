import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { AccountRegistry, ACCOUNT_NAME_MAX } from '../lib/store/accounts.js'
import { AccountNotes, NOTE_MAX_BYTES } from '../lib/store/notes.js'
import { CachedMarketData } from '../lib/data/cached-market-data.js'
import { PaperService } from '../lib/service/paper-service.js'
import { AccountRepo } from '../lib/store/repo.js'
import { WeekdayTradingCalendar } from '../lib/data/trading-calendar-port.js'

/** Scratch `$DSH_HOME`; each test owns its own ledger tree. */
async function withHome(name, body) {
  const home = join(process.cwd(), 'build', 'paper-trading-test', `accounts-${name}-${process.pid}-${Date.now()}`)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await body(home)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
}

function createContext() {
  const tools = []
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
        callback({ get: () => ({ register: tool => tools.push(tool) }) })
      }
      return undefined
    },
  }
  const call = async (endpoint, payload = {}, account) => {
    const response = await routes[0].fetch(new Request('http://127.0.0.1/api/ft-paper-trading', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload, ...(account === undefined ? {} : { account }) }),
    }))
    assert.equal(response.status, 200)
    return response.json()
  }
  /** Host timers keep the loop alive; every test disposes its effects. */
  const dispose = async () => {
    for (const fn of effects) await fn()
  }
  return { ctx, tools, routes, call, dispose }
}

function countingData(now) {
  const counter = { quotes: 0, bars: 0 }
  const prices = new Map([['600519.SH', { last: 10, prevClose: 9.9 }]])
  const port = {
    async quotes(symbols) {
      counter.quotes += 1
      const rows = symbols.filter(symbol => prices.has(symbol)).map(symbol => ({
        symbol,
        ...prices.get(symbol),
        marketTs: now().toISOString(),
        fetchedAt: now().toISOString(),
        source: 'fake',
      }))
      return { state: rows.length > 0 ? 'ok' : 'failed', quotes: rows }
    },
    async dailyBars() { counter.bars += 1; return { state: 'ok', bars: [] } },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search() { return [] },
    async marketList() { return { state: 'ok', quotes: [], page: 1 } },
  }
  return { counter, port }
}

test('registry: seeds the two legacy accounts and persists a v4 file', async () => {
  await withHome('seed', async home => {
    const registry = new AccountRegistry({ home })
    const view = await registry.view()
    assert.deepEqual(view.accounts.map(item => item.id).sort(), ['default', 'futures'])
    assert.deepEqual(view.accounts.map(item => item.name).sort(), ['期货账户', '默认账户'].sort())
    const file = JSON.parse(await readFile(join(home, 'paper-trading', 'accounts.json'), 'utf8'))
    assert.equal(file.version, 4)
    assert.equal(file.accounts.length, 2)
    // No session information is persisted: the plugin has no session concept.
    assert.equal(file.bindings, undefined)
    assert.equal(file.lockBindings, undefined)
    const again = new AccountRegistry({ home })
    assert.equal((await again.view()).accounts.length, 2)
  })
})

test('registry: create, rename, and duplicate names are allowed', async () => {
  await withHome('create', async home => {
    const registry = new AccountRegistry({ home })
    const created = await registry.create({ name: '价值组', initialCashCents: 50_000_000 })
    assert.match(created.id, /^acc-[a-z0-9]+$/)
    assert.equal(created.name, '价值组')
    assert.equal((await registry.resolve('价值组')).id, created.id)
    assert.equal((await registry.resolve(created.id)).name, '价值组')
    assert.equal((await registry.resolve()).id, 'default')
    // Duplicate display names are allowed; a name lookup then asks for the id.
    const twin = await registry.create({ name: '价值组' })
    let ambiguous
    try {
      await registry.resolve('价值组')
    } catch (error) {
      ambiguous = error
    }
    assert.ok(ambiguous, 'duplicate names must not resolve to a guess')
    assert.match(String(ambiguous.message), /不唯一/)
    assert.match(String(ambiguous.message), new RegExp(created.id))
    assert.equal((await registry.resolve(twin.id)).name, '价值组')
    // Rename keeps the id.
    const renamed = await registry.rename(created.id, '价值小组')
    assert.equal(renamed.id, created.id)
    assert.equal((await registry.resolve('价值小组')).id, created.id)
    // Unknown reference is a typed error, not a silent default.
    await assert.rejects(() => registry.resolve('不存在的账户'), error => error.code === 'ACCOUNT_NOT_FOUND')
    // Length limits.
    await assert.rejects(() => registry.create({ name: 'x'.repeat(ACCOUNT_NAME_MAX + 1) }), /账户名不能超过/)
    // The default accounts stay visible: archiving one strands the panel.
    await assert.rejects(() => registry.archive('default'), /默认账户不能归档/)
    // An explicit empty reference is a mistake, not "the default account".
    await assert.rejects(() => registry.resolve('  '), /账户名不能为空/)
    // The futures pseudo-account is fixed: renaming it would not change any
    // panel, and archiving it is already refused.
    await assert.rejects(() => registry.rename('futures', '第二期货'), /期货账户名称固定/)
  })
})

test('notes: one text block per account, rewritten wholesale and capped', async () => {
  await withHome('notes', async home => {
    const notes = new AccountNotes({ home })
    const empty = await notes.read('default')
    assert.equal(empty.text, '')
    assert.equal(empty.bytes, 0)
    // Long, multi-line content is stored verbatim.
    const long = `${'策略思路第一段\n'.repeat(200)}最后一行`
    const saved = await notes.write('default', long)
    assert.equal(saved.text, long)
    assert.ok(saved.bytes > 2000, JSON.stringify(saved.bytes))
    assert.ok(typeof saved.updatedAt === 'string' && saved.updatedAt.length > 0)
    assert.equal((await notes.read('default')).text, long)
    // Replace semantics: the previous text disappears, nothing is appended.
    const second = await notes.write('default', '第二版')
    assert.equal(second.text, '第二版')
    assert.equal((await notes.read('default')).text, '第二版')
    // Notes belong to one account.
    assert.equal((await notes.read('acc-other')).text, '')
    // Over-cap writes are rejected instead of truncated.
    await assert.rejects(() => notes.write('default', 'x'.repeat(NOTE_MAX_BYTES + 1)), /不能超过/)
    await assert.rejects(() => notes.write('default', 42), /文本/)
    // Concurrent saves queue instead of racing for one temp file.
    const results = await Promise.all(['A', 'B', 'C'].map(text => notes.write('default', text)))
    assert.equal(results.length, 3)
    assert.equal((await notes.read('default')).text, 'C')
    // Persisted under the account directory, not in the registry file.
    assert.equal(await readFile(join(home, 'paper-trading', 'default', 'note.md'), 'utf8'), 'C')
  })
})

test('registry: archive implies frozen, preserves the lock flag, and survives a reload', async () => {
  await withHome('flags', async home => {
    const registry = new AccountRegistry({ home })
    const created = await registry.create({ name: '实验组' })
    await registry.lock(created.id)
    const archived = await registry.archive(created.id)
    assert.equal(archived.archived, true)
    // Archiving does not rewrite the lock flag: the service treats archived as
    // frozen on its own, so unarchiving restores exactly the previous state.
    assert.equal(archived.locked, true)
    const reloaded = await new AccountRegistry({ home }).resolve(created.id)
    assert.equal(reloaded.locked, true)
    assert.equal(reloaded.archived, true)
    // Archived accounts are out of the picker view but still addressable.
    const visible = await registry.view()
    assert.equal(visible.accounts.some(item => item.id === created.id), false)
    assert.equal((await registry.view({ includeArchived: true })).accounts.some(item => item.id === created.id), true)
    assert.equal(registry.archivedSync(created.id), true)
    assert.equal((await registry.resolve(created.id)).id, created.id)
    await registry.unarchive(created.id)
    assert.equal(registry.archivedSync(created.id), false)
    const restored = await registry.resolve(created.id)
    assert.equal(restored.archived, false)
    // The pre-archive lock is still there, as the user left it.
    assert.equal(restored.locked, true)
  })
})

test('registry: v1/v2 files (archived, bindings, note) still load', async () => {
  await withHome('legacy', async home => {
    await mkdir(join(home, 'paper-trading'), { recursive: true })
    await writeFile(join(home, 'paper-trading', 'accounts.json'), JSON.stringify({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tickMs: 5000,
      lockBindings: true,
      accounts: [
        { id: 'default', kind: 'stock', name: '默认账户', createdAt: '2026-01-01T00:00:00.000Z', archived: false, locked: false },
        { id: 'acc-old', kind: 'stock', name: '老账户', createdAt: '2026-01-01T00:00:00.000Z', archived: true, locked: false },
      ],
      bindings: { 'session-1': 'acc-old' },
    }))
    const registry = new AccountRegistry({ home })
    const view = await registry.view({ includeArchived: true })
    assert.equal(view.accounts.length, 3) // default + futures + acc-old
    assert.equal(view.accounts.find(item => item.id === 'acc-old').archived, true)
    const file = JSON.parse(await readFile(join(home, 'paper-trading', 'accounts.json'), 'utf8'))
    assert.equal(file.version, 4)
    assert.equal(file.bindings, undefined)
  })
})

test('registry: discovers an unknown ledger directory instead of hiding it', async () => {
  await withHome('discover', async home => {
    const dir = join(home, 'paper-trading', 'legacy-hand-made')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'events.jsonl'), '')
    const registry = new AccountRegistry({ home })
    const found = (await registry.view({ includeArchived: true })).accounts.find(item => item.id === 'legacy-hand-made')
    assert.ok(found, 'discovered account is registered')
    assert.equal(found.kind, 'stock')
  })
})

test('registry: an unreadable accounts.json falls back to the defaults', async () => {
  await withHome('corrupt', async home => {
    await mkdir(join(home, 'paper-trading'), { recursive: true })
    await writeFile(join(home, 'paper-trading', 'accounts.json'), '{ not json')
    const registry = new AccountRegistry({ home })
    const view = await registry.view()
    assert.deepEqual(view.accounts.map(item => item.id).sort(), ['default', 'futures'])
  })
})

test('cache: one upstream call per symbol per tick, failures included', async () => {
  let clock = 1_000_000
  const upstream = {
    calls: 0,
    async quotes(symbols) {
      upstream.calls += 1
      return {
        state: 'ok',
        quotes: symbols.map(symbol => ({ symbol, last: 10, marketTs: '2026-11-19T02:00:00.000Z' })),
      }
    },
    async dailyBars() { return { state: 'ok', bars: [] } },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search() { return [] },
    async marketList() { return { state: 'ok', quotes: [], page: 1 } },
  }
  const cached = new CachedMarketData(upstream, { ttlMs: 5_000, now: () => clock })
  const [first, second] = await Promise.all([cached.quotes(['600519.SH']), cached.quotes(['600519.SH'])])
  assert.equal(upstream.calls, 1)
  assert.deepEqual(first.quotes, second.quotes)
  await cached.quotes(['600519.SH'])
  assert.equal(upstream.calls, 1)
  await cached.quotes(['600519.SH', '000001.SZ'])
  assert.equal(upstream.calls, 2)
  clock += 6_000
  await cached.quotes(['600519.SH'])
  assert.equal(upstream.calls, 3)
})

test('cache: a failed fetch is negative-cached instead of hammering upstream', async () => {
  let clock = 1_000_000
  let calls = 0
  const upstream = {
    async quotes() {
      calls += 1
      return { state: 'failed', quotes: [], notice: '额度用尽', noticeCode: 'quota' }
    },
    async dailyBars() { return { state: 'ok', bars: [] } },
    async minuteBars() { return { state: 'ok', bars: [] } },
    async search() { return [] },
    async marketList() { return { state: 'ok', quotes: [], page: 1 } },
  }
  const cached = new CachedMarketData(upstream, { ttlMs: 5_000, now: () => clock })
  const first = await cached.quotes(['600519.SH'])
  assert.equal(first.state, 'failed')
  assert.equal(first.noticeCode, 'quota')
  await cached.quotes(['600519.SH'])
  assert.equal(calls, 1, 'failure stays cached for at least the failure TTL')
  clock += 61_000
  await cached.quotes(['600519.SH'])
  assert.equal(calls, 2)
})

test('cache: two accounts asking for the same symbol cost one upstream call', async () => {
  await withHome('shared', async home => {
    const now = new Date('2026-11-19T02:00:00.000Z')
    const { counter, port } = countingData(() => now)
    const cached = new CachedMarketData(port, { now: () => now.getTime() })
    const make = accountId => new PaperService({
      repo: new AccountRepo({ home, accountId }),
      data: cached,
      calendar: new WeekdayTradingCalendar(),
      now: () => now,
      accountId,
    })
    const draft = { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 }
    const [left, right] = await Promise.all([make('acc-one').preview(draft), make('acc-two').preview(draft)])
    assert.equal(counter.quotes, 1, 'shared cache folds both accounts into one upstream call')
    assert.equal(left.quote.last, right.quote.last)
  })
})

test('tick: an account with no resting order costs zero quote calls', async () => {
  await withHome('tick', async home => {
    // Mutable clock so the quote gate (5 s live interval) can allow a fetch.
    let clock = new Date('2026-11-19T02:00:00.000Z').getTime() // 10:00 Asia/Shanghai
    const now = () => new Date(clock)
    const { counter, port } = countingData(now)
    const service = new PaperService({
      repo: new AccountRepo({ home, accountId: 'acc-tick' }),
      data: port,
      calendar: new WeekdayTradingCalendar(),
      now,
      accountId: 'acc-tick',
    })
    // Buy and hold: the position is display-only, so a host tick must not fetch.
    await service.place({ symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
    counter.quotes = 0
    await service.tick({ includePositions: false })
    assert.equal(counter.quotes, 0, 'holding a position does not need quotes in a background tick')
    // A resting limit order is the one thing a background tick must watch.
    await service.place({ symbol: '600519.SH', side: 'buy', type: 'limit', qty: 100, limitPrice: 9 })
    counter.quotes = 0
    clock += 6_000
    await service.tick({ includePositions: false })
    assert.equal(counter.quotes, 1, 'a resting order costs exactly one quote fetch')
    // The panel-facing tick still refreshes positions for display.
    clock += 6_000
    await service.tick()
    assert.equal(counter.quotes, 2, 'a visible tick also marks the held position')
  })
})

test('host: one route serves every account by id or name', async () => {
  await withHome('host', async () => {
    const { ctx, call, dispose } = createContext()
    apply(ctx)
    try {
      const listed = await call('accounts/list')
      assert.equal(listed.ok, true)
      assert.deepEqual(listed.value.accounts.map(item => item.id).sort(), ['default', 'futures'])
      // The stock panel asks for its own plane instead of filtering client-side.
      const stockOnly = await call('accounts/list', { kind: 'stock' })
      assert.deepEqual(stockOnly.value.accounts.map(item => item.id), ['default'])
      assert.equal(listed.value.defaultIds.stock, 'default')
      // v1 only creates stock accounts: a futures entry would be a dead end.
      const futures = await call('accounts/create', { name: '第二期货', kind: 'futures' })
      assert.equal(futures.ok, false)
      assert.match(futures.error.message, /只支持新建股票账户/)
      // Create a second stock account with its own starting cash.
      const created = await call('accounts/create', { name: '价值组', initialCash: 500_000 })
      assert.equal(created.ok, true)
      const id = created.value.id
      // Each account has its own ledger and its own starting cash.
      const byDefault = await call('account/get')
      const byName = await call('account/get', {}, '价值组')
      const byId = await call('account/get', {}, id)
      assert.equal(byDefault.value.accountId, 'default')
      assert.equal(byName.value.accountId, id)
      assert.equal(byId.value.initialCash, 500_000)
      assert.notEqual(byDefault.value.ledgerPath, byName.value.ledgerPath)
      // Unknown account is a typed failure, not a silent default.
      const missing = await call('account/get', {}, '没有这个账户')
      assert.equal(missing.ok, false)
      assert.equal(missing.error.code, 'ACCOUNT_NOT_FOUND')
      // Rename is a metadata-only edit.
      await call('accounts/rename', { id, name: '价值小组' })
      const renamed = (await call('accounts/list')).value.accounts.find(item => item.id === id)
      assert.equal(renamed.name, '价值小组')
      assert.equal((await call('account/get', {}, '价值小组')).value.accountId, id)
      // Notes are a per-account text block with replace semantics.
      assert.equal((await call('note/get', {}, id)).value.text, '')
      const noteText = '第一版策略\n持有 3 个交易日\n'
      const savedNote = await call('note/set', { text: noteText }, id)
      assert.equal(savedNote.value.text, noteText)
      assert.equal((await call('note/get', {}, id)).value.text, noteText)
      await call('note/set', { text: '第二版' }, id)
      assert.equal((await call('note/get', {}, id)).value.text, '第二版')
      // The default account keeps its own (empty) note.
      assert.equal((await call('note/get')).value.text, '')
      // Over-cap notes are refused at the RPC boundary too.
      const tooLong = await call('note/set', { text: 'x'.repeat(100_001) }, id)
      assert.equal(tooLong.ok, false)
      assert.match(tooLong.error.message, /不能超过/)
      // Comparison lists stock accounts only, archived ones excluded.
      const compared = await call('compare/get')
      assert.equal(compared.ok, true)
      assert.deepEqual(compared.value.accounts.map(row => row.id).sort(), ['default', id].sort())
      const valueRow = compared.value.accounts.find(row => row.id === id)
      assert.equal(valueRow.initialCash, 500_000)
      assert.ok(Array.isArray(valueRow.points))
      assert.equal(valueRow.locked, false)
      // Archiving drops it from the picker and freezes it, but not from the ledger.
      await call('accounts/archive', { id })
      const visible = (await call('accounts/list')).value.accounts.some(item => item.id === id)
      assert.equal(visible, false)
      assert.equal((await call('account/get', {}, id)).value.accountId, id)
      assert.equal((await call('accounts/list', { includeArchived: true })).value.accounts.some(item => item.id === id), true)
      assert.equal((await call('compare/get')).value.accounts.some(row => row.id === id), false)
      // Locking blocks state changes but keeps reads alive.
      await call('accounts/lock', { id })
      const order = await call('order/place', { draft: { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 } }, id)
      assert.equal(order.ok, false)
      assert.equal(order.error.code, 'ACCOUNT_LOCKED')
      assert.equal((await call('market/status', {}, id)).ok, true)
      // Unlock lets the request through to the (degraded) market check.
      await call('accounts/unlock', { id })
      const retried = await call('order/place', { draft: { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100, price: 10 } }, id)
      assert.notEqual(retried.error?.code, 'ACCOUNT_LOCKED')
      // The registry lock covers the futures plane too (the futures route
      // bypasses the paper guard, so the service itself must refuse).
      assert.equal((await call('accounts/lock', { id: 'futures' })).ok, true)
      const lockedFutures = await call('futures/order', {
        draft: { symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1 },
        requestId: 'futures-locked-1',
      })
      assert.equal(lockedFutures.ok, false)
      assert.equal(lockedFutures.error.code, 'ACCOUNT_LOCKED')
      assert.equal((await call('futures/account/deposit', { amount: 1000 })).error.code, 'ACCOUNT_LOCKED')
      assert.equal((await call('futures/account/get')).ok, true)
      assert.equal((await call('accounts/unlock', { id: 'futures' })).ok, true)
      // Duplicate names are allowed; name resolution then demands the id.
      await call('accounts/create', { name: '价值小组' })
      const ambiguous = await call('account/get', {}, '价值小组')
      assert.equal(ambiguous.ok, false)
      assert.match(ambiguous.error.message, /不唯一/)
    } finally {
      await dispose()
    }
  })
})

test('tools: the paper_stock_* tools take an account argument instead of a binding', async () => {
  await withHome('tools', async () => {
    const { ctx, tools, call, dispose } = createContext()
    apply(ctx)
    try {
      const created = await call('accounts/create', { name: '策略一', initialCash: 500_000 })
      const id = created.value.id
      const accountTool = tools.find(tool => tool.name === 'paper_account')
      const stockAccount = tools.find(tool => tool.name === 'paper_stock_account')
      assert.ok(accountTool && stockAccount, 'both tools are registered')
      // Without an account argument the call lands on the default account.
      const before = await stockAccount.execute({})
      assert.equal(before.data.account.accountId, 'default')
      // With a name (or id) it lands on that ledger; nothing is remembered.
      const mine = await stockAccount.execute({ account: '策略一' })
      assert.equal(mine.data.account.accountId, id)
      const byId = await stockAccount.execute({ account: id })
      assert.equal(byId.data.account.accountId, id)
      // There is no per-session state: the same call without the argument is
      // still the default account after the explicit one.
      assert.equal((await stockAccount.execute({})).data.account.accountId, 'default')
      // The account tool administers metadata, not "current account" state.
      const listed = await accountTool.execute({ action: 'list' })
      assert.equal(listed.data.accounts.length, 3)
      // Account notes are human-only: the tool has no such action.
      assert.equal('note' in (accountTool.parameters?.properties ?? {}), false)
      const archived = await accountTool.execute({ action: 'archive', name: '策略一' })
      assert.equal(archived.data.archived, true)
      assert.equal((await accountTool.execute({ action: 'list' })).data.accounts.length, 2)
      assert.equal((await accountTool.execute({ action: 'list', includeArchived: true })).data.accounts.length, 3)
      // An archived account is frozen: the tool must refuse trading with the
      // archive code before any lock is involved.
      const orderTool = tools.find(tool => tool.name === 'paper_stock_order')
      const archivedOrder = await orderTool.execute({ account: id, symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
      assert.match(archivedOrder.summary, /ACCOUNT_ARCHIVED/)
      // Restoring keeps the ledger addressable and clears the freeze.
      const unarchived = await accountTool.execute({ action: 'unarchive', name: '策略一' })
      assert.equal(unarchived.data.archived, false)
      // Archiving/locking without a name used to hit the default account silently.
      const noName = await accountTool.execute({ action: 'lock' })
      assert.match(noName.summary, /需要 name/)
      // Locking must bind the tools too, not just the RPC route: an agent call
      // resolves the service directly and used to bypass the lock.
      await call('accounts/lock', { id })
      const lockedOrder = await orderTool.execute({ account: id, symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
      assert.match(lockedOrder.summary, /ACCOUNT_LOCKED/)
      const lockedReset = await accountTool.execute({ action: 'unlock', name: '策略一' })
      assert.equal(lockedReset.data.locked, false)
    } finally {
      await dispose()
    }
  })
})
