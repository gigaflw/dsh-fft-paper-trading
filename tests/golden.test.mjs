/**
 * Golden (characterization) tests: end-to-end behavior frozen before the
 * stock/futures consolidation refactor.
 *
 * Every scenario drives the real plugin through `apply` → HTTP route → services
 * → JSONL ledger files, with a frozen clock and deterministic data ports. The
 * golden JSON contains the normalized response of every step plus the final
 * on-disk store (registry + event streams + file tree).
 *
 * To regenerate after a *deliberate* behavior change:
 *   GOLDEN_UPDATE=1 node --test tests/golden.test.mjs
 * then review the diff: every changed line must be explained by the change.
 */
import test from 'node:test'
import { createWorld, makeNormalizer, captureStore, checkGolden } from './golden/harness.mjs'

/** One scenario recorder: raw result for the next step, normalized copy for the golden. */
function recorder(world) {
  const normalize = makeNormalizer(world.home)
  const steps = []
  return {
    steps,
    normalize,
    async step(label, run) {
      const result = await run()
      steps.push({ step: label, result: normalize(result) })
      return result
    },
    async tool(label, name, args = {}) {
      const result = await world.tool(name, args)
      steps.push({ step: label, tool: name, args: normalize(args), result: normalize(result) })
      return result
    },
  }
}

test('golden: stock account over two trading days', async () => {
  const world = await createWorld({ name: 'stock-day' })
  try {
    const record = recorder(world)
    const call = (label, endpoint, payload = {}, account) =>
      record.step(label, () => world.call(endpoint, payload, account))

    await call('account opened on first read', 'account/get')
    await call('market status', 'market/status')
    const preview = await call('preview a market buy', 'order/preview', {
      symbol: '600519.SH', side: 'buy', type: 'market', qty: 100,
    })
    const buy = await call('place the market buy', 'order/place', {
      draft: { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 },
      requestId: 'buy-1',
    })
    await call('preview a resting limit buy', 'order/preview', {
      symbol: '000001.SZ', side: 'buy', type: 'limit', qty: 5000, limitPrice: 11,
    })
    const resting = await call('place the resting limit buy', 'order/place', {
      draft: { symbol: '000001.SZ', side: 'buy', type: 'limit', qty: 5000, limitPrice: 11 },
      requestId: 'rest-1',
    })
    await call('tick while the limit is not crossed', 'tick')
    // The market moves through the resting bid: the next tick must fill it.
    world.stock.prices.get('000001.SZ').last = 10.95
    world.clock.set('2026-11-16T10:05:00+08:00')
    await call('tick after the market crosses the limit', 'tick')
    const cancelPreview = await call('place a far limit to cancel', 'order/place', {
      draft: { symbol: '600519.SH', side: 'buy', type: 'limit', qty: 100, limitPrice: 1400 },
      requestId: 'cancel-1',
    })
    await call('cancel the far limit', 'order/cancel', { orderId: cancelPreview.value.id })
    await call('deposit cash', 'account/deposit', { amount: 10000 })
    await call('withdraw cash', 'account/withdraw', { amount: 5000 })

    world.clock.set('2026-11-16T15:30:00+08:00')
    await call('close the day on the next read', 'account/get')
    await call('review the day', 'review/get', { period: 'all' })
    await call('daily report', 'review/daily')
    await call('cash flow', 'cash/flow')

    world.clock.set('2026-11-17T09:35:00+08:00')
    await call('pre-open and open the next day', 'account/get')
    await call('orders after the roll', 'list/orders')
    await call('review seven days', 'review/get', { period: '7d' })

    // The filled/resting orders above must have produced exactly these ids.
    if (buy.value.status !== 'filled') throw new Error('expected a filled buy')
    if (resting.value.status !== 'pending') throw new Error('expected a resting order')
    if (preview.value.warnings.length !== 0) throw new Error('preview should be warning-free')

    const store = await captureStore(world.home, record.normalize)
    await checkGolden('stock-day', { steps: record.steps, store })
  } finally {
    await world.dispose()
  }
})

test('golden: multi-account registry, locks and notes', async () => {
  const world = await createWorld({ name: 'stock-multi' })
  try {
    const record = recorder(world)
    const call = (label, endpoint, payload = {}, account) =>
      record.step(label, () => world.call(endpoint, payload, account))

    await call('registry lists the two seeded accounts', 'accounts/list')
    const value = await call('create a stock account', 'accounts/create', { name: '价值组', initialCash: 500000 })
    const momentum = await call('create a second stock account', 'accounts/create', { name: '动量组' })
    await call('read by display name', 'account/get', {}, '价值组')
    const valueId = value.value.id
    await call('trade the second account', 'order/place', {
      draft: { symbol: '000001.SZ', side: 'buy', type: 'market', qty: 200 },
      requestId: 'value-1',
    }, '价值组')
    await call('the default account is untouched', 'account/get')
    await call('rename the account', 'accounts/rename', { id: valueId, name: '价值小组' })
    await call('the old display name no longer resolves', 'account/get', {}, '价值组')
    await call('hide the third account', 'accounts/hide', { id: momentum.value.id })
    await call('hidden accounts leave the list', 'accounts/list')
    await call('a hidden account still answers by id', 'account/get', {}, momentum.value.id)
    const locked = await call('lock the traded account', 'accounts/lock', { id: valueId })
    await call('a locked account refuses orders', 'order/place', {
      draft: { symbol: '000001.SZ', side: 'buy', type: 'market', qty: 100 },
      requestId: 'value-2',
    }, '价值小组')
    await call('a locked account still previews', 'order/preview', {
      symbol: '000001.SZ', side: 'buy', type: 'market', qty: 100,
    }, '价值小组')
    await call('unlock', 'accounts/unlock', { id: valueId })
    await call('read the note', 'note/get', {}, '价值小组')
    await call('write the note', 'note/set', { text: '长期持有 600519，回撤 10% 减半。' }, '价值小组')
    await call('read it back', 'note/get', {}, '价值小组')
    await call('comparison rows', 'compare/get')
    await call('registry including hidden', 'accounts/list', { includeHidden: true })

    if (locked.value.locked !== true) throw new Error('expected the account to be locked')

    const store = await captureStore(world.home, record.normalize)
    await checkGolden('stock-multi', { steps: record.steps, store })
  } finally {
    await world.dispose()
  }
})

test('golden: futures account over one settlement day', async () => {
  const world = await createWorld({ name: 'futures-day' })
  try {
    const record = recorder(world)
    const call = (label, endpoint, payload = {}) =>
      record.step(label, () => world.call(endpoint, payload))

    await call('futures account opened on first read', 'futures/account/get')
    await call('contract index', 'futures/contracts', {})
    await call('quote the contract', 'futures/quote', { symbols: ['RB2611.SHFE'] })
    await call('session status', 'futures/status')
    await call('preview an open', 'futures/preview', {
      symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1,
    })
    const opened = await call('open a long', 'futures/order', {
      draft: { symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1 },
      requestId: 'fut-open',
    })
    await call('positions after the open', 'futures/positions')
    world.clock.set('2026-11-16T10:05:00+08:00')
    await call('tick marks the position', 'futures/tick')
    await call('preview a close', 'futures/preview', {
      symbol: 'RB2611.SHFE', side: 'long', offset: 'close', type: 'market', qty: 1,
    })
    await call('close the long', 'futures/order', {
      draft: { symbol: 'RB2611.SHFE', side: 'long', offset: 'close', type: 'market', qty: 1 },
      requestId: 'fut-close',
    })
    await call('open again and hold into settlement', 'futures/order', {
      draft: { symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1 },
      requestId: 'fut-hold',
    })
    world.clock.set('2026-11-16T15:31:00+08:00')
    await call('tick settles the day', 'futures/tick')
    await call('account after settlement', 'futures/account/get')
    await call('positions after settlement', 'futures/positions')
    await call('review all', 'futures/review', { period: 'all' })
    await call('cash flow', 'futures/cash/flow')
    await call('ledger snapshots', 'futures/ledger/list')

    if (opened.value.status !== 'filled') throw new Error('expected a filled open')

    const store = await captureStore(world.home, record.normalize)
    await checkGolden('futures-day', { steps: record.steps, store })
  } finally {
    await world.dispose()
  }
})

test('golden: agent tool surface', async () => {
  const world = await createWorld({ name: 'tools' })
  try {
    const record = recorder(world)

    await record.tool('stock account tool', 'paper_stock_account', {})
    await record.tool('market tool', 'paper_stock_market', { action: 'search', query: '600519.SH' })
    await record.tool('quote tool', 'paper_stock_quote', { symbols: ['600519.SH'] })
    await record.tool('preview tool', 'paper_stock_preview', { symbol: '600519.SH', side: 'buy', type: 'market', qty: 100 })
    await record.tool('order tool', 'paper_stock_order', {
      symbol: '600519.SH', side: 'buy', type: 'market', qty: 100, requestId: 'tool-1',
    })
    const resting = await record.tool('resting order tool', 'paper_stock_order', {
      symbol: '000001.SZ', side: 'buy', type: 'limit', qty: 1000, limitPrice: 11, requestId: 'tool-2',
    })
    await record.tool('cancel tool', 'paper_stock_cancel', { orderId: resting.data.id })
    await record.tool('review tool', 'paper_stock_review', { period: 'all' })
    await record.tool('account admin tool', 'paper_account', { action: 'list' })
    await record.tool('account create tool', 'paper_account', { action: 'create', name: '工具账户', initialCash: 200000 })
    await record.tool('ledger tool', 'paper_ledger', { action: 'list' })
    await record.tool('futures contracts tool', 'paper_futures_contracts', {})
    await record.tool('futures quote tool', 'paper_futures_quote', { symbols: ['RB2611.SHFE'] })
    await record.tool('futures preview tool', 'paper_futures_preview', {
      symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1,
    })
    await record.tool('futures order tool', 'paper_futures_order', {
      symbol: 'RB2611.SHFE', side: 'long', offset: 'open', type: 'market', qty: 1, requestId: 'tool-fut-1',
    })
    await record.tool('futures review tool', 'paper_futures_review', { period: 'all' })

    const store = await captureStore(world.home, record.normalize)
    await checkGolden('tools', { steps: record.steps, store })
  } finally {
    await world.dispose()
  }
})
