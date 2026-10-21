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
 * @module @ft/dsh-fft-paper-trading
 */
import { registerPaperTools } from './agent/tools.js';
import { FtshareMarketData } from './data/ftshare-market-data.js';
import { UnavailableMarketData } from './data/unavailable-market-data.js';
import { PaperService } from './service/paper-service.js';
import { createPaperRoute } from './service/route.js';
import { createPaperRpcHandler } from './service/rpc.js';
import { AccountRepo } from './store/repo.js';
import { resolveDshHome } from './store/paths.js';
import { DEFAULT_ACCOUNT_ID } from './contract.js';
export * from './contract.js';
export { PaperService } from './service/paper-service.js';
export { createPaperRpcHandler } from './service/rpc.js';
export { createPaperRoute } from './service/route.js';
export { AccountRepo } from './store/repo.js';
export { FtshareMarketData } from './data/ftshare-market-data.js';
export { UnavailableMarketData } from './data/unavailable-market-data.js';
export const name = '@ft/dsh-fft-paper-trading';
/**
 * Services are attached lazily: the browser scan needs this row's fiber, so the
 * plugin must not gate activation on optional services.
 */
export function apply(ctx) {
    const logger = ctx.logger('ft-paper-trading');
    const home = resolveDshHome();
    const repo = new AccountRepo({ home, accountId: DEFAULT_ACCOUNT_ID, logger });
    // One mutable slot behind a stable port: the service holds the port, the
    // FTShare adapter can appear (or disappear) later without rebuilding the
    // service, the route or the tools.
    let market = new UnavailableMarketData();
    const data = {
        quotes: symbols => market.quotes(symbols),
        dailyBars: (symbol, limit) => market.dailyBars(symbol, limit),
    };
    const service = new PaperService({ repo, data, logger });
    const handler = createPaperRpcHandler(service);
    ctx.inject(['ftshareData'], scope => {
        const adapter = new FtshareMarketData(scope.get('ftshareData'));
        market = adapter;
        scope.effect(() => () => {
            if (market === adapter)
                market = new UnavailableMarketData();
        }, 'ft-paper-trading: FTShare adapter');
    });
    ctx.inject(['connection'], scope => {
        const connection = scope.get('connection');
        scope.effect(() => connection.fetch.register(createPaperRoute(handler)), 'ft-paper-trading: /api route');
    });
    ctx.inject(['tools'], scope => {
        registerPaperTools(scope.get('tools'), service);
    });
}
//# sourceMappingURL=index.js.map