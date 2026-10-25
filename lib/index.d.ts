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
import type { Context } from '@deepseek-ai/cordis';
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
export declare const name = "@dsh-ft/dsh-fft-paper-trading";
/**
 * Services are attached lazily: the browser scan needs this row's fiber, so the
 * plugin must not gate activation on optional services.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map