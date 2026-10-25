/**
 * Host entry for the paper-trading plugin.
 *
 * One business row carries both halves: this entry attaches the RPC route and
 * the `paper_*` tools lazily; the browser half is a separate static module
 * loaded by DSH's module scan.
 *
 * The three attachments are independent on purpose. Market data is the only
 * optional dependency — the ledger, the panel and the tools must stay available
 * without it, so quotes degrade to the port's `failed` state instead of taking
 * the whole row down.
 * @module @dsh-ft/dsh-fft-paper-trading
 */
import { registerFuturesTools } from './agent/futures-tools.js';
import { registerPaperTools } from './agent/tools.js';
import { FtshareMarketData } from './data/ftshare-market-data.js';
import { FtshareFuturesMarketData } from './data/futures-market-data.js';
import { FtshareTradingCalendar } from './data/ftshare-trading-calendar.js';
import { WeekdayTradingCalendar } from './data/trading-calendar-port.js';
import { UnavailableMarketData } from './data/unavailable-market-data.js';
import { FuturesService } from './service/futures-service.js';
import { createFuturesRpcHandler } from './service/futures-rpc.js';
import { PaperService } from './service/paper-service.js';
import { createPaperRoute } from './service/route.js';
import { createPaperRpcHandler } from './service/rpc.js';
import { PaperScheduler } from './service/scheduler.js';
import { probeDataSource } from './service/data-source.js';
import { AccountRepo } from './store/repo.js';
import { FuturesRepo } from './store/futures-repo.js';
import { resolveDshHome } from './store/paths.js';
import { ShortlistStore } from './store/shortlist.js';
import { DEFAULT_ACCOUNT_ID } from './contract.js';
import { UnavailableFuturesMarketData } from './data/unavailable-futures-market-data.js';
export * from './contract.js';
export { PaperService } from './service/paper-service.js';
export { createPaperRpcHandler } from './service/rpc.js';
export { createPaperRoute } from './service/route.js';
export { PaperScheduler } from './service/scheduler.js';
export { AccountRepo } from './store/repo.js';
export { FtshareMarketData } from './data/ftshare-market-data.js';
export { FtshareFuturesMarketData } from './data/futures-market-data.js';
export { FtshareTradingCalendar } from './data/ftshare-trading-calendar.js';
export { WeekdayTradingCalendar } from './data/trading-calendar-port.js';
export { UnavailableMarketData } from './data/unavailable-market-data.js';
export * from './futures-contract.js';
export { FuturesService } from './service/futures-service.js';
export { FuturesError } from './service/futures-service.js';
export { createFuturesRpcHandler } from './service/futures-rpc.js';
export { FuturesRepo } from './store/futures-repo.js';
export { UnavailableFuturesMarketData } from './data/unavailable-futures-market-data.js';
export const name = '@dsh-ft/dsh-fft-paper-trading';
/**
 * Services are attached lazily: the browser scan needs this row's fiber, so the
 * plugin must not gate activation on optional services.
 */
export function apply(ctx) {
    const logger = ctx.logger('ft-paper-trading');
    const home = resolveDshHome();
    const repo = new AccountRepo({ home, accountId: DEFAULT_ACCOUNT_ID, logger });
    const shortlist = new ShortlistStore(home);
    // One mutable slot behind a stable port: the service holds the port, the
    // FTShare adapter can appear (or disappear) later without rebuilding the
    // service, the route or the tools.
    let market = new UnavailableMarketData();
    let calendar = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算');
    const data = {
        quotes: symbols => market.quotes(symbols),
        dailyBars: (symbol, limit) => market.dailyBars(symbol, limit),
        minuteBars: (symbol, date) => market.minuteBars(symbol, date),
        search: (query, limit) => market.search(query, limit),
        marketList: input => market.marketList(input),
    };
    // Data-source state for the panel header. Both flags are filled by the lazy
    // `ctx.inject` blocks below, so the panel can say "no source" before FTShare
    // arrives and flip to "free/configured" when the service appears.
    let dataService = false;
    let settings;
    const service = new PaperService({ repo, data, calendar, shortlist, logger });
    // Futures: separate ledger, separate service, same route. The market-data
    // port stays on the degraded stand-in until the FTShare futures adapter is
    // wired in; the ledger and the tools must work without it.
    let futuresMarket = new UnavailableFuturesMarketData();
    const futuresRepo = new FuturesRepo({ home, logger });
    const futuresCalendar = {
        get source() {
            return calendar.source;
        },
        get status() {
            return calendar.status;
        },
        isTradingDay: date => calendar.isTradingDay(date),
        nextTradingDay: date => calendar.nextTradingDay(date),
        tradingDays: (from, to) => calendar.tradingDays(from, to),
    };
    const futuresService = new FuturesService({
        repo: futuresRepo,
        data: {
            contracts: refresh => futuresMarket.contracts(refresh),
            quotes: symbols => futuresMarket.quotes(symbols),
            limits: symbols => futuresMarket.limits(symbols),
            settle: symbols => futuresMarket.settle(symbols),
            closes: (symbols, date) => futuresMarket.closes(symbols, date),
        },
        calendar: futuresCalendar,
        logger,
    });
    const futuresHandler = createFuturesRpcHandler(futuresService);
    // The panel header reads one status: credential state plus the latest market
    // failure across both accounts (the two share the data service).
    const dataSource = async () => {
        const probe = await probeDataSource({ dataService, settings });
        const problems = [service.problem(), futuresService.problem()]
            .filter((problem) => problem !== undefined)
            .sort((left, right) => right.at.localeCompare(left.at));
        return problems.length === 0 ? probe : { ...probe, problem: problems[0] };
    };
    const paperHandler = createPaperRpcHandler(service, { dataSource });
    // `futures/*` goes to the futures handler; every other endpoint keeps the
    // stock handler, so the browser half needs one route only.
    const handler = (endpoint, payload, signal) => endpoint.startsWith('futures/')
        ? futuresHandler(endpoint, payload, signal)
        : paperHandler(endpoint, payload, signal);
    // Matching and day settlement must not depend on the panel being open: the
    // host fiber drives `tick` even while the browser half is unmounted.
    const scheduler = new PaperScheduler({ logger, tick: () => service.tick() });
    ctx.effect(() => {
        scheduler.start();
        return () => scheduler.stop();
    }, 'ft-paper-trading: matching scheduler');
    // Futures settlement must also run while the panel is closed: the 15:30
    // roll and force liquidation are driven from the host fiber.
    const futuresScheduler = new PaperScheduler({ logger, tick: () => futuresService.tick() });
    ctx.effect(() => {
        futuresScheduler.start();
        return () => futuresScheduler.stop();
    }, 'ft-paper-trading: futures scheduler');
    ctx.inject(['ftshareData'], scope => {
        const service = scope.get('ftshareData');
        const adapter = new FtshareMarketData(service);
        const calendarAdapter = new FtshareTradingCalendar(service);
        const futuresAdapter = new FtshareFuturesMarketData(service);
        market = adapter;
        calendar = calendarAdapter;
        futuresMarket = futuresAdapter;
        dataService = true;
        scope.effect(() => () => {
            if (market === adapter)
                market = new UnavailableMarketData();
            if (calendar === calendarAdapter)
                calendar = new WeekdayTradingCalendar('未安装 FTShare 数据服务，按工作日估算');
            if (futuresMarket === futuresAdapter)
                futuresMarket = new UnavailableFuturesMarketData();
            dataService = false;
        }, 'ft-paper-trading: FTShare adapter');
    });
    // The key itself never leaves the settings service: only "is a key
    // configured, and did its last check pass" is read, for the header badge.
    ctx.inject(['ftshareSettings'], scope => {
        const handle = scope.get('ftshareSettings');
        settings = handle;
        scope.effect(() => () => {
            if (settings === handle)
                settings = undefined;
        }, 'ft-paper-trading: FTShare key status');
    });
    ctx.inject(['connection'], scope => {
        const connection = scope.get('connection');
        scope.effect(() => connection.fetch.register(createPaperRoute(handler)), 'ft-paper-trading: /api route');
    });
    ctx.inject(['tools'], scope => {
        const tools = scope.get('tools');
        registerPaperTools(tools, service);
        registerFuturesTools(tools, futuresService);
    });
}
//# sourceMappingURL=index.js.map