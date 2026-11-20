/**
 * Host entry for the paper-trading plugin.
 *
 * One business row carries both halves: this entry attaches the RPC route and
 * the `paper_*` tools lazily; the browser half is a separate static module
 * loaded by DSH's module scan.
 *
 * Accounts: the registry (`accounts.json`) owns the account list, so this entry
 * builds one {@link PaperService} per stock account on demand and hands every
 * resolved target to the same RPC route. The default account is created eagerly
 * because the tools predate multi-account and still bind to it.
 *
 * The three attachments are independent on purpose. Market data is the only
 * optional dependency — the ledger, the panel and the tools must stay available
 * without it, so quotes degrade to the port's `failed` state instead of taking
 * the whole row down.
 * @module @dsh-ft/dsh-fft-paper-trading
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { registerAccountTools } from './agent/account-tools.js'
import { registerFuturesTools } from './agent/futures-tools.js'
import { registerLedgerTools } from './agent/ledger-tools.js'
import { registerPaperTools, type ServiceResolver, type ToolsLike } from './agent/tools.js'
import { CachedMarketData } from './data/cached-market-data.js'
import { FtshareMarketData, type FtshareDataLike } from './data/ftshare-market-data.js'
import { FtshareFuturesMarketData } from './data/futures-market-data.js'
import { FtshareTradingCalendar } from './data/ftshare-trading-calendar.js'
import type { MarketDataPort } from './data/market-data-port.js'
import { UnavailableMarketData } from './data/unavailable-market-data.js'
import type { TradingCalendarPort } from './data/trading-calendar-port.js'
import { WeekdayTradingCalendar } from './data/trading-calendar-port.js'
import { createAccountsRpcHandler } from './service/accounts-rpc.js'
import { createCompareRpcHandler } from './service/compare-rpc.js'
import { PaperError } from './service/errors.js'
import { FuturesService } from './service/futures-service.js'
import { createFuturesRpcHandler } from './service/futures-rpc.js'
import { PaperService } from './service/paper-service.js'
import { createPaperRoute, type HostConnectionLike } from './service/route.js'
import { createPaperRpcHandler, type PaperRpcHandler, type PaperRpcResolver } from './service/rpc.js'
import { PaperScheduler } from './service/scheduler.js'
import { probeDataSource, type FtshareSettingsLike } from './service/data-source.js'
import { AccountNotes } from './store/notes.js'
import { AccountRegistry, DEFAULT_TICK_MS } from './store/accounts.js'
import { AccountRepo } from './store/repo.js'
import { FuturesRepo } from './store/futures-repo.js'
import { resolveDshHome } from './store/paths.js'
import { ShortlistStore } from './store/shortlist.js'
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS, type AccountMeta, type DataSourceStatus } from './contract.js'
import { UnavailableFuturesMarketData } from './data/unavailable-futures-market-data.js'
import type { FuturesMarketDataPort } from './data/futures-market-data-port.js'
import { FUTURES_ACCOUNT_ID } from './futures-contract.js'

export * from './contract.js'
export { PaperService } from './service/paper-service.js'
export { createPaperRpcHandler } from './service/rpc.js'
export type { PaperRpcTarget, PaperRpcResolver } from './service/rpc.js'
export { createAccountsRpcHandler } from './service/accounts-rpc.js'
export { createCompareRpcHandler } from './service/compare-rpc.js'
export { registerAccountTools } from './agent/account-tools.js'
export { createPaperRoute } from './service/route.js'
export { PaperScheduler } from './service/scheduler.js'
export { AccountRepo } from './store/repo.js'
export { AccountRegistry, DEFAULT_TICK_MS, MAX_ACCOUNTS_PER_KIND } from './store/accounts.js'
export { AccountNotes } from './store/notes.js'
export { CachedMarketData } from './data/cached-market-data.js'
export { FtshareMarketData } from './data/ftshare-market-data.js'
export { FtshareFuturesMarketData } from './data/futures-market-data.js'
export { FtshareTradingCalendar } from './data/ftshare-trading-calendar.js'
export { WeekdayTradingCalendar } from './data/trading-calendar-port.js'
export { UnavailableMarketData } from './data/unavailable-market-data.js'
export * from './futures-contract.js'
export { FuturesService } from './service/futures-service.js'
export { FuturesError } from './service/futures-service.js'
export { createFuturesRpcHandler } from './service/futures-rpc.js'
export { FuturesRepo } from './store/futures-repo.js'
export { UnavailableFuturesMarketData } from './data/unavailable-futures-market-data.js'

export const name = '@dsh-ft/dsh-fft-paper-trading'

/**
 * Test seams. Production omits all of them: the real clock and the FTShare
 * adapters are used. The golden suite injects a frozen clock and deterministic
 * data ports to pin end-to-end behavior across refactors.
 */
export interface ApplyOptions {
  now?: () => Date
  marketData?: MarketDataPort
  futuresMarketData?: FuturesMarketDataPort
}

/**
 * Services are attached lazily: the browser scan needs this row's fiber, so the
 * plugin must not gate activation on optional services.
 */
export function apply(ctx: Context, options: ApplyOptions = {}): void {
  const logger = ctx.logger('ft-paper-trading')
  const home = resolveDshHome()
  const shortlist = new ShortlistStore(home)
  const registry = new AccountRegistry({
    home,
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  // Notes live beside each ledger, not in the registry: a long note must not
  // bloat accounts.json, and the model has no tool for them.
  const notes = new AccountNotes({ home })
  /** Quote cache lifetime; replaced by the persisted value once the registry loads. */
  let tickMs = DEFAULT_TICK_MS

  // One mutable slot behind a stable port: the services hold the ports, the
  // FTShare adapter can appear (or disappear) later without rebuilding the
  // services, the route or the tools.
  let market: MarketDataPort = options.marketData ?? new UnavailableMarketData()
  let calendar: TradingCalendarPort = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算')
  const data: MarketDataPort = {
    quotes: symbols => market.quotes(symbols),
    dailyBars: (symbol, limit) => market.dailyBars(symbol, limit),
    minuteBars: (symbol, date) => market.minuteBars(symbol, date),
    search: (query, limit) => market.search(query, limit),
    marketList: input => market.marketList(input),
  }
  // Every account shares one cache: N accounts holding the same symbol must not
  // cost N upstream calls, and inside one tick they must all see one price.
  const clockNow = options.now
  const cached = new CachedMarketData(data, {
    ttlMs: () => tickMs,
    ...(clockNow === undefined ? {} : { now: () => clockNow().getTime() }),
  })
  // Same trick for the calendar: both services take this port once, and the
  // slot behind it is swapped when the FTShare adapter arrives. Handing the
  // slot itself to the stocks service left it on the weekday fallback for the
  // whole session, so T+1, order expiry and day rolls ignored the holidays.
  const calendarPort: TradingCalendarPort = {
    get source() {
      return calendar.source
    },
    get status() {
      return calendar.status
    },
    isTradingDay: date => calendar.isTradingDay(date),
    nextTradingDay: date => calendar.nextTradingDay(date),
    tradingDays: (from, to) => calendar.tradingDays(from, to),
  }

  // Data-source state for the panel header. Both flags are filled by the lazy
  // `ctx.inject` blocks below, so the panel can say "no source" before FTShare
  // arrives and flip to "free/configured" when the service appears.
  let dataService = false
  let settings: FtshareSettingsLike | undefined

  /** One service per stock account, created on first use and kept forever. */
  const stockServices = new Map<string, PaperService>()
  const stockService = (meta: AccountMeta): PaperService => {
    const existing = stockServices.get(meta.id)
    if (existing !== undefined) return existing
    const accountSettings = meta.initialCashCents === undefined
      ? DEFAULT_SETTINGS
      : { ...DEFAULT_SETTINGS, initialCashCents: meta.initialCashCents }
    const service = new PaperService({
      repo: new AccountRepo({ home, accountId: meta.id, logger }),
      data: cached,
      calendar: calendarPort,
      shortlist,
      settings: accountSettings,
      accountId: meta.id,
      logger,
      ...(options.now === undefined ? {} : { now: options.now }),
      // Read the registry, not this meta: `accounts/lock` mutates the live
      // entry, and the service map is shared with the scheduler's copies.
      isLocked: () => registry.lockedSync(meta.id),
    })
    stockServices.set(meta.id, service)
    return service
  }

  // Futures: separate ledger, separate service, same route. The market-data
  // port stays on the degraded stand-in until the FTShare futures adapter is
  // wired in; the ledger and the tools must work without it.
  let futuresMarket: FuturesMarketDataPort = options.futuresMarketData ?? new UnavailableFuturesMarketData()
  const futuresRepo = new FuturesRepo({ home, logger })
  const futuresService = new FuturesService({
    repo: futuresRepo,
    data: {
      contracts: refresh => futuresMarket.contracts(refresh),
      quotes: symbols => futuresMarket.quotes(symbols),
      limits: symbols => futuresMarket.limits(symbols),
      settle: symbols => futuresMarket.settle(symbols),
      closes: (symbols, date) => futuresMarket.closes(symbols, date),
    },
    calendar: calendarPort,
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
    isLocked: () => registry.lockedSync(FUTURES_ACCOUNT_ID),
  })
  const futuresHandler = createFuturesRpcHandler(futuresService)
  // The panel header reads one status: credential state plus the latest market
  // failure across every account (they share the data service).
  const dataSource = async (): Promise<DataSourceStatus> => {
    const probe = await probeDataSource({ dataService, settings })
    const problems = [...stockServices.values()]
      .map(item => item.problem())
      .concat(futuresService.problem())
      .filter((problem): problem is NonNullable<typeof problem> => problem !== undefined)
      .sort((left, right) => right.at.localeCompare(left.at))
    return problems.length === 0 ? probe : { ...probe, problem: problems[0] }
  }
  // Resolve an account id/name to its stock service. A futures account reaching
  // this path is a caller bug, not a silent fallback.
  const resolveStock: PaperRpcResolver = async account => {
    const meta = await registry.resolve(account)
    if (meta.kind !== 'stock') throw new PaperError('INVALID_ARGUMENT', `账户「${meta.name}」不是股票账户`)
    return { service: stockService(meta), meta }
  }
  const paperHandler = createPaperRpcHandler(resolveStock, { dataSource, notes })
  const accountsHandler = createAccountsRpcHandler(registry)
  // The comparison page reads every visible account; hidden ones are only
  // reachable by id, so they stay out of the board.
  const compareHandler = createCompareRpcHandler({
    accounts: async () => (await registry.view()).accounts.filter(meta => meta.kind === 'stock'),
    serviceOf: meta => stockService(meta),
  })
  // `futures/*`, `accounts/*` and `compare/*` have their own handlers;
  // everything else keeps the stock handler, so the browser half needs one
  // route only.
  const handler: PaperRpcHandler = (endpoint, payload, signal, account) =>
    endpoint.startsWith('futures/')
      ? futuresHandler(endpoint, payload, signal)
      : endpoint.startsWith('accounts/')
        ? accountsHandler(endpoint, payload, signal, account)
        : endpoint.startsWith('compare/')
          ? compareHandler(endpoint, payload, signal, account)
          : paperHandler(endpoint, payload, signal, account)

  // Matching and day settlement must not depend on the panel being open: the
  // host fiber drives `tick` even while the browser half is unmounted. One
  // scheduler walks every registered account, so a resting order fills for an
  // account the panel never opened; the shared cache keeps the cost flat.
  const scheduler = new PaperScheduler({
    logger,
    tick: async () => {
      // Hidden accounts still have orders: hiding is a panel concern, not a
      // reason to stop matching a resting order.
      const view = await registry.view({ includeHidden: true })
      for (const meta of view.accounts) {
        if (meta.kind !== 'stock') continue
        // Orders only: marking positions is display work, and nobody is looking
        // while the panel is closed. An account with no resting order therefore
        // costs zero quote calls.
        await stockService(meta).tick({ includePositions: false })
      }
    },
  })
  ctx.effect(
    () => {
      scheduler.start()
      return () => scheduler.stop()
    },
    'ft-paper-trading: matching scheduler',
  )
  // Futures settlement must also run while the panel is closed: the 15:30
  // roll and force liquidation are driven from the host fiber.
  const futuresScheduler = new PaperScheduler({ logger, tick: () => futuresService.tick() })
  ctx.effect(
    () => {
      futuresScheduler.start()
      return () => futuresScheduler.stop()
    },
    'ft-paper-trading: futures scheduler',
  )
  // Read the persisted tick once; it only tunes the quote cache lifetime.
  ctx.effect(
    () => {
      void registry
        .tickMs()
        .then(value => {
          tickMs = value
        })
        .catch(() => undefined)
      return () => undefined
    },
    'ft-paper-trading: account registry',
  )

  ctx.inject(['ftshareData'], scope => {
    if (options.marketData !== undefined || options.futuresMarketData !== undefined) return
    const service = scope.get('ftshareData') as unknown as FtshareDataLike
    const adapter = new FtshareMarketData(service)
    const calendarAdapter = new FtshareTradingCalendar(service)
    const futuresAdapter = new FtshareFuturesMarketData(service)
    market = adapter
    calendar = calendarAdapter
    futuresMarket = futuresAdapter
    dataService = true
    // Cached quotes came from the previous adapter (or the stand-in).
    cached.clear()
    scope.effect(
      () => () => {
        if (market === adapter) market = new UnavailableMarketData()
        if (calendar === calendarAdapter) calendar = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算')
        if (futuresMarket === futuresAdapter) futuresMarket = new UnavailableFuturesMarketData()
        cached.clear()
        dataService = false
      },
      'ft-paper-trading: FTShare adapter',
    )
  })

  // The key itself never leaves the settings service: only "is a key
  // configured, and did its last check pass" is read, for the header badge.
  ctx.inject(['ftshareSettings'], scope => {
    const handle = scope.get('ftshareSettings') as unknown as FtshareSettingsLike
    settings = handle
    scope.effect(
      () => () => {
        if (settings === handle) settings = undefined
      },
      'ft-paper-trading: FTShare key status',
    )
  })

  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as unknown as HostConnectionLike
    scope.effect(
      () => connection.fetch.register(createPaperRoute(handler)),
      'ft-paper-trading: /api route',
    )
  })

  ctx.inject(['tools'], scope => {
    const tools = scope.get('tools') as unknown as ToolsLike
    // Same seven tool names for every account: the tool's `account` argument
    // (name or id, default = the default account) decides which ledger answers.
    const resolveToolService: ServiceResolver = async account => {
      const meta = await registry.resolve(account)
      if (meta.kind !== 'stock') throw new PaperError('INVALID_ARGUMENT', `账户「${meta.name}」不是股票账户`)
      return stockService(meta)
    }
    registerPaperTools(tools, resolveToolService)
    registerAccountTools(tools, { registry })
    registerFuturesTools(tools, futuresService)
    // Resolve on demand: an eagerly-created service would capture the
    // pre-registry lock flag and ignore later `accounts/lock`. The reference
    // accepts the same forms as every other tool plus the legacy family words.
    registerLedgerTools(tools, {
      resolve: async reference => {
        if (reference === 'futures') {
          return { kind: 'futures', service: futuresService, accountId: FUTURES_ACCOUNT_ID }
        }
        const resolved = await resolveStock(reference === undefined || reference === '' || reference === 'stock' ? undefined : reference)
        if (resolved.meta === undefined) throw new PaperError('INTERNAL', '账户解析缺少元数据')
        return { kind: 'stock', service: resolved.service, accountId: resolved.meta.id }
      },
    })
  })
}
