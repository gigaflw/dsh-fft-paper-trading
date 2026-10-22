/**
 * Futures account service.
 *
 * Owns the clock advance (day open / settlement / trade-date roll), the data
 * port plumbing and the ledger transactions. Core stays pure; the service is
 * the only place that knows about FTShare, the trading calendar and the wall
 * clock, exactly like the stock-side `PaperService`.
 *
 * @module @ft/dsh-fft-paper-trading/service/futures-service
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_FUTURES_SETTINGS, FUTURES_ACCOUNT_ID } from '../futures-contract.js';
import { todayTradeDate } from '../core/calendar.js';
import { emptyState, normalizeFuturesSettings } from '../core/futures/ledger.js';
import { cancelOrder, closeDay, openAccount, openDay, resetAccount, submit, tick as engineTick } from '../core/futures/engine.js';
import { daySessionsFor, isoAt, OPEN_MINUTES, parseDaySessions, phaseAt, SETTLEMENT_MINUTES, } from '../core/futures/session.js';
import { fillViews, marketStatusAt, orderViews, positionViews, previewOrder, quoteView, toAccountView, toOrderView, toReview, } from '../core/futures/views.js';
/** Data calls are chunked to the adapter's documented 20-symbol batch cap. */
const SYMBOL_BATCH = 20;
const MAX_CONTRACTS = 500;
export class FuturesError extends Error {
    code;
    status;
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'FuturesError';
    }
}
function chunks(items, size) {
    const out = [];
    for (let index = 0; index < items.length; index += size)
        out.push(items.slice(index, index + size));
    return out;
}
function reasonText(reason, limit = 120) {
    if (reason === undefined || reason === '')
        return '';
    const flat = reason.replace(/\s+/g, ' ').trim();
    return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}
function toTerms(meta) {
    return {
        symbol: meta.symbol,
        name: meta.name,
        product: meta.product,
        exchange: meta.exchange,
        multiplier: meta.multiplier,
        tickSize: meta.tickSize,
        marginRate: meta.marginRate,
        tradeHours: meta.tradeHours,
        deListDate: meta.deListDate,
        volume: meta.volume,
    };
}
function toContractView(terms) {
    return {
        symbol: terms.symbol,
        name: terms.name,
        product: terms.product,
        exchange: terms.exchange,
        multiplier: terms.multiplier,
        tickSize: terms.tickSize,
        marginRate: terms.marginRate,
        tradeHours: terms.tradeHours,
        deListDate: terms.deListDate,
    };
}
/** Orchestrates the futures ledger, the market-data port, the calendar and the clock. */
export class FuturesService {
    options;
    settings;
    accountId;
    now;
    contractsCache;
    constructor(options) {
        this.options = options;
        this.settings = normalizeFuturesSettings(options.settings ?? DEFAULT_FUTURES_SETTINGS);
        this.accountId = options.accountId ?? FUTURES_ACCOUNT_ID;
        this.now = options.now ?? (() => new Date());
    }
    ts() {
        return this.now().toISOString();
    }
    viewOf(state) {
        return toAccountView(state, this.options.repo.ledgerPath);
    }
    blocked(state) {
        const reason = reasonText(state.blockedReason);
        return new FuturesError('ACCOUNT_BLOCKED', `账户已锁定，请重置后继续${reason === '' ? '' : `（${reason}）`}`, 409);
    }
    // ---------------------------------------------------------------- account --
    async account() {
        return this.viewOf(await this.sync());
    }
    async ensureAccount() {
        const outcome = await this.options.repo.transact(async (state) => {
            if (state.tradeDate !== '')
                return { events: [], value: undefined };
            const now = this.now();
            const tradeDate = await this.tradeDateForNow(now);
            const result = openAccount(state, this.settings, tradeDate, now.toISOString(), this.accountId);
            return { events: result.events, value: undefined };
        });
        return outcome.state;
    }
    async sync() {
        await this.ensureAccount();
        return (await this.advanceTo()).state;
    }
    /** Trade date a fresh account starts on; after 15:30 it is already the next day. */
    async tradeDateForNow(now) {
        const today = todayTradeDate(now);
        const nowIso = now.toISOString();
        if (await this.options.calendar.isTradingDay(today)) {
            return nowIso >= isoAt(today, SETTLEMENT_MINUTES) ? this.options.calendar.nextTradingDay(today) : today;
        }
        return this.options.calendar.nextTradingDay(today);
    }
    /**
     * Idempotent clock advance: settle every due trade date at 15:30 and open the
     * current one at 09:00. Runs inside one store transaction so concurrent reads
     * cannot duplicate a settlement event.
     */
    async advanceTo() {
        const outcome = await this.options.repo.transact(async (state) => {
            const events = [];
            const notices = [];
            const expired = [];
            if (state.tradeDate === '' || state.blocked) {
                return { events, value: { notices, expired } };
            }
            const now = this.now();
            const nowIso = now.toISOString();
            const today = todayTradeDate(now);
            let current = state;
            const apply = (result) => {
                events.push(...result.events);
                current = result.state;
                if (result.notices !== undefined)
                    notices.push(...result.notices);
                if (result.expired !== undefined)
                    expired.push(...result.expired);
            };
            for (let guard = 0; guard < 400; guard += 1) {
                const settlementAt = isoAt(current.tradeDate, SETTLEMENT_MINUTES);
                if (current.tradeDate < today || (current.tradeDate === today && nowIso >= settlementAt)) {
                    const closes = await this.fetchCloses(current);
                    const next = await this.options.calendar.nextTradingDay(current.tradeDate);
                    apply(closeDay(current, {
                        date: current.tradeDate,
                        nextTradeDate: next,
                        ts: settlementAt,
                        recordedAt: nowIso,
                        closes: closes.prices,
                        closeSource: closes.source,
                        warnings: closes.notice === undefined ? [] : [closes.notice],
                    }));
                    continue;
                }
                if (current.tradeDate === today) {
                    if (nowIso >= isoAt(today, OPEN_MINUTES) && current.lastOpenedDate !== today) {
                        const opens = await this.fetchOpens(current);
                        apply(openDay(current, {
                            date: today,
                            ts: isoAt(today, OPEN_MINUTES),
                            recordedAt: nowIso,
                            opens: opens.prices,
                        }));
                        if (opens.notice !== undefined)
                            notices.push(opens.notice);
                    }
                    break;
                }
                break;
            }
            return { events, value: { notices, expired } };
        });
        return { state: outcome.state, notices: outcome.value.notices, expired: outcome.value.expired };
    }
    /** Symbols whose price the account cares about: open orders and held positions. */
    symbolsInPlay(state) {
        const symbols = new Set();
        for (const position of Object.values(state.positions))
            symbols.add(position.symbol);
        for (const order of Object.values(state.orders)) {
            if (order.status === 'pending')
                symbols.add(order.symbol);
        }
        return [...symbols];
    }
    // ------------------------------------------------------------------- data --
    async callBatched(symbols, call) {
        const unique = [...new Set(symbols)];
        if (unique.length === 0)
            return { state: 'ok', value: [] };
        const values = [];
        for (const batch of chunks(unique, SYMBOL_BATCH)) {
            try {
                const result = await call(batch);
                if (result.state !== 'ok')
                    return { state: result.state, notice: result.notice };
                values.push(...(result.value ?? []));
            }
            catch (error) {
                this.options.logger?.warn(`paper-trading: futures market data failed: ${String(error)}`);
                return { state: 'failed', notice: error instanceof Error ? error.message : String(error) };
            }
        }
        return { state: 'ok', value: values };
    }
    async fetchQuoteMap(symbols) {
        const result = await this.callBatched(symbols, batch => this.options.data.quotes(batch));
        const quotes = new Map();
        for (const row of result.value ?? []) {
            if (row.symbol === undefined || !Number.isFinite(row.last) || row.last <= 0)
                continue;
            quotes.set(row.symbol, {
                last: row.last,
                preSettlement: row.preSettlement,
                volume: row.volume,
                openInterest: row.openInterest,
                marketTs: row.marketTs,
            });
        }
        return { state: result.state, quotes, notice: result.notice };
    }
    async fetchLimitMap(symbols) {
        const result = await this.callBatched(symbols, batch => this.options.data.limits(batch));
        const limits = new Map();
        for (const row of result.value ?? []) {
            if (row.symbol === undefined || !Number.isFinite(row.upper) || !Number.isFinite(row.lower))
                continue;
            limits.set(row.symbol, { upper: row.upper, lower: row.lower, marginRate: row.marginRate, source: row.source });
        }
        return { state: result.state, limits, notice: result.notice };
    }
    async fetchSettleMap(symbols) {
        const result = await this.callBatched(symbols, batch => this.options.data.settle(batch));
        const settles = new Map();
        for (const row of result.value ?? []) {
            if (row.symbol === undefined)
                continue;
            settles.set(row.symbol, {
                feePerLotCents: row.feePerLotCents,
                closeTodayFeePerLotCents: row.closeTodayFeePerLotCents,
                longMarginRate: row.longMarginRate,
                feeRate: row.feeRate,
                closeTodayFeeRate: row.closeTodayFeeRate,
            });
        }
        return { state: result.state, settles, notice: result.notice };
    }
    async fetchCloses(state) {
        const symbols = this.symbolsInPlay(state);
        if (symbols.length === 0)
            return { prices: {}, source: 'daily' };
        const result = await this.callBatched(symbols, batch => this.options.data.closes(batch, state.tradeDate));
        if (result.state !== 'ok') {
            const quoteResult = await this.fetchQuoteMap(symbols);
            if (quoteResult.state === 'ok' && quoteResult.quotes.size > 0) {
                const prices = Object.fromEntries([...quoteResult.quotes].map(([symbol, quote]) => [symbol, quote.last]));
                return { prices, source: 'quote', notice: result.notice };
            }
            return { prices: {}, source: 'missing', notice: result.notice ?? '收盘价不可用，结算使用最近一次盯市价' };
        }
        const prices = {};
        for (const row of result.value ?? []) {
            if (row.symbol === undefined || !Number.isFinite(row.close) || row.close <= 0)
                continue;
            prices[row.symbol] = row.close;
        }
        const missing = symbols.filter(symbol => prices[symbol] === undefined);
        if (missing.length === 0)
            return { prices, source: 'daily' };
        const quoteResult = await this.fetchQuoteMap(missing);
        if (quoteResult.state !== 'ok')
            return { prices, source: 'missing', notice: result.notice ?? '部分收盘价缺失，使用最近一次盯市价' };
        for (const [symbol, quote] of quoteResult.quotes)
            prices[symbol] = quote.last;
        return { prices, source: 'quote', notice: result.notice ?? '部分收盘价缺失，已用最新价替代' };
    }
    async fetchOpens(state) {
        const symbols = this.symbolsInPlay(state);
        if (symbols.length === 0)
            return { prices: {} };
        const quoteResult = await this.fetchQuoteMap(symbols);
        if (quoteResult.state !== 'ok')
            return { prices: {}, notice: quoteResult.notice ?? '开盘价不可用，沿用上一收盘价' };
        return { prices: Object.fromEntries([...quoteResult.quotes].map(([symbol, quote]) => [symbol, quote.last])) };
    }
    async ensureContracts(tradeDate, refresh = false) {
        const cached = this.contractsCache;
        if (cached !== undefined && cached.tradeDate === tradeDate && !refresh)
            return cached;
        let result;
        try {
            result = await this.options.data.contracts(refresh);
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: futures contract index failed: ${String(error)}`);
            result = { state: 'failed', notice: error instanceof Error ? error.message : String(error) };
        }
        if (result.state === 'ok' && result.value !== undefined) {
            const map = new Map();
            for (const meta of result.value) {
                if (meta.symbol === undefined || !(meta.multiplier > 0) || !(meta.tickSize > 0))
                    continue;
                map.set(meta.symbol, toTerms(meta));
            }
            this.contractsCache = { tradeDate, map, state: 'ok' };
            return this.contractsCache;
        }
        if (cached !== undefined && cached.tradeDate === tradeDate) {
            return { ...cached, state: 'stale', notice: result.notice ?? '合约索引刷新失败，使用缓存' };
        }
        return { tradeDate, map: new Map(), state: 'stale', notice: result.notice ?? '合约索引不可用' };
    }
    async symbolData(state, symbol, nowIso) {
        const contracts = await this.ensureContracts(state.tradeDate);
        const contract = contracts.map.get(symbol);
        const sessions = daySessionsFor(contract);
        const warnings = [];
        if (contracts.state === 'stale' && contracts.notice !== undefined)
            warnings.push(contracts.notice);
        const fetchSymbols = symbol === '' ? [] : [symbol];
        const [quoteResult, limitResult, settleResult] = await Promise.all([
            this.fetchQuoteMap(fetchSymbols),
            this.fetchLimitMap(fetchSymbols),
            this.fetchSettleMap(fetchSymbols),
        ]);
        for (const result of [quoteResult, limitResult, settleResult]) {
            if (result.state !== 'ok' && result.notice !== undefined)
                warnings.push(result.notice);
        }
        const tradeDaysToDeList = await this.tradeDaysToDeList(state.tradeDate, contract);
        const quote = quoteResult.quotes.get(symbol);
        let settle = settleResult.settles.get(symbol);
        // Some exchanges (e.g. RB on SHFE) publish `trading_fee = 0` plus an
        // ad-valorem `trading_fee_rate`. The per-lot fee is a snapshot, so convert
        // the rate with the current price; callers see a normal per-lot fee.
        const params = settleResult.settles.get(symbol);
        const toPerLot = (rate) => {
            if (quote === undefined || contract === undefined)
                return undefined;
            if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
                return undefined;
            // The upstream unit is per-mille for the common case (0.1 = 0.1‰);
            // values already in fraction form (<= 0.01) are used as-is.
            const fraction = rate > 0.01 ? rate / 1000 : rate;
            return Math.max(1, Math.round(quote.last * contract.multiplier * 100 * fraction));
        };
        const rate = params?.feeRate;
        if (settle !== undefined && (settle.feePerLotCents === undefined || settle.feePerLotCents === 0)) {
            const perLotCents = toPerLot(rate);
            if (perLotCents !== undefined) {
                const closePerLot = toPerLot(params?.closeTodayFeeRate);
                settle = {
                    ...settle,
                    feePerLotCents: perLotCents,
                    ...(closePerLot === undefined ? {} : { closeTodayFeePerLotCents: closePerLot }),
                };
                warnings.push(closePerLot === undefined
                    ? `该合约按成交额计费，按 ${(perLotCents / 100).toFixed(2)} 元/手估算`
                    : `该合约按成交额计费，开仓约 ${(perLotCents / 100).toFixed(2)} 元/手、平今约 ${(closePerLot / 100).toFixed(2)} 元/手`);
            }
        }
        return {
            contract,
            quote,
            limit: limitResult.limits.get(symbol),
            settle,
            sessions,
            tradeDaysToDeList,
            warnings: [...new Set(warnings)],
        };
    }
    async tradeDaysToDeList(tradeDate, contract) {
        const deListDate = contract?.deListDate;
        if (deListDate === undefined || deListDate === '')
            return undefined;
        if (deListDate <= tradeDate)
            return 0;
        try {
            const days = await this.options.calendar.tradingDays(tradeDate, deListDate);
            if (days.length === 0)
                return undefined;
            // Inclusive list; the distance is the number of trading days after today.
            return Math.max(0, days.length - 1);
        }
        catch {
            return undefined;
        }
    }
    // ---------------------------------------------------------------- reading --
    async contracts(query = {}) {
        const state = await this.sync();
        const cache = await this.ensureContracts(state.tradeDate, query.refresh === true);
        const text = query.query?.trim().toLowerCase() ?? '';
        const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? 50)), MAX_CONTRACTS);
        const rows = [...cache.map.values()].filter(terms => {
            if (query.exchange !== undefined && terms.exchange !== query.exchange)
                return false;
            if (text === '')
                return true;
            return terms.symbol.toLowerCase().includes(text)
                || (terms.name ?? '').toLowerCase().includes(text)
                || terms.product.toLowerCase().includes(text);
        });
        rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
        return {
            state: cache.state,
            contracts: rows.slice(0, limit).map(toContractView),
            notice: cache.notice,
        };
    }
    async quote(symbols) {
        const cleaned = symbols.map(symbol => symbol.trim()).filter(symbol => symbol !== '');
        const result = await this.fetchQuoteMap(cleaned);
        const cache = await this.ensureContracts(todayTradeDate(this.now()));
        const quotes = cleaned.flatMap(symbol => {
            const quote = result.quotes.get(symbol);
            if (quote === undefined)
                return [];
            const terms = [...cache.map.values()].find(item => item.symbol === symbol);
            return [quoteView(symbol, quote, terms?.name)];
        });
        return { state: result.state, quotes, notice: result.notice };
    }
    async status() {
        const state = await this.sync();
        return marketStatusAt(state.tradeDate, parseDaySessions(undefined), this.ts());
    }
    async positions() {
        return positionViews(await this.sync());
    }
    async orders() {
        return orderViews(await this.sync());
    }
    async trades() {
        return fillViews(await this.sync());
    }
    async review(period = '30d') {
        const state = await this.sync();
        return toReview(state, period, todayTradeDate(this.now()));
    }
    async exportLedger() {
        const ledger = await this.options.repo.readLedger();
        if (ledger.content === null)
            return { path: ledger.path, exists: false, notice: '账本文件尚未创建' };
        return { path: ledger.path, exists: true, content: ledger.content };
    }
    // ---------------------------------------------------------------- writing --
    async preview(draft) {
        const state = await this.sync();
        const symbol = typeof draft.symbol === 'string' ? draft.symbol.trim() : '';
        const data = await this.symbolData(state, symbol, this.ts());
        return previewOrder({
            state,
            draft,
            contract: data.contract,
            quote: data.quote,
            limit: data.limit,
            settle: data.settle,
            sessions: data.sessions,
            nowIso: this.ts(),
            tradeDaysToDeList: data.tradeDaysToDeList,
            warnings: data.warnings,
        });
    }
    async place(draft, requestId = randomUUID()) {
        const state = await this.sync();
        if (state.blocked)
            throw this.blocked(state);
        const symbol = typeof draft.symbol === 'string' ? draft.symbol.trim() : '';
        const data = await this.symbolData(state, symbol, this.ts());
        const nowIso = this.ts();
        const phase = phaseAt(nowIso, state.tradeDate, data.sessions);
        if (phase !== 'trading') {
            throw new FuturesError('SESSION_CLOSED', '当前非期货日盘连续交易时段，不接受委托', 409);
        }
        const outcome = await this.options.repo.transact(current => {
            const duplicate = Object.values(current.orders).find(order => order.requestId === requestId);
            if (duplicate !== undefined)
                return { events: [], value: { duplicateId: duplicate.id } };
            if (current.blocked)
                return { events: [], value: { blocked: true } };
            const result = submit(current, draft, {
                tradeDate: current.tradeDate,
                phase,
                contract: data.contract,
                quote: data.quote,
                limit: data.limit,
                settle: data.settle,
                tradeDaysToDeList: data.tradeDaysToDeList,
            }, requestId, nowIso);
            return { events: result.events, value: { orderId: result.order?.id } };
        });
        if (outcome.value.duplicateId !== undefined) {
            const duplicate = outcome.state.orders[outcome.value.duplicateId];
            if (duplicate === undefined)
                throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404);
            if (duplicate.symbol !== draft.symbol || duplicate.side !== draft.side
                || duplicate.offset !== draft.offset || duplicate.type !== draft.type || duplicate.qty !== draft.qty) {
                throw new FuturesError('INVALID_ARGUMENT', 'requestId 已被另一笔不同的委托占用', 409);
            }
            return toOrderView(duplicate);
        }
        if (outcome.value.blocked === true || outcome.state.blocked)
            throw this.blocked(outcome.state);
        const order = outcome.value.orderId === undefined ? undefined : outcome.state.orders[outcome.value.orderId];
        if (order === undefined)
            throw new FuturesError('INTERNAL', '订单未写入账本', 500);
        return toOrderView(order);
    }
    async cancel(orderId) {
        const state = await this.sync();
        if (state.blocked)
            throw this.blocked(state);
        const outcome = await this.options.repo.transact(current => {
            if (current.blocked)
                return { events: [], value: { blocked: true } };
            if (current.orders[orderId] === undefined)
                return { events: [], value: { missing: true } };
            const result = cancelOrder(current, orderId, this.ts());
            if (result.events.length === 0)
                return { events: [], value: { notPending: true } };
            return { events: result.events, value: {} };
        });
        if (outcome.value.blocked === true)
            throw this.blocked(outcome.state);
        if (outcome.value.missing === true)
            throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404);
        if (outcome.value.notPending === true)
            throw new FuturesError('ORDER_NOT_PENDING', '订单不是挂单状态', 409);
        const order = outcome.state.orders[orderId];
        if (order === undefined)
            throw new FuturesError('ORDER_NOT_FOUND', '订单不存在', 404);
        return toOrderView(order);
    }
    async tick() {
        const advanced = await this.advanceTo();
        const state = advanced.state;
        const notices = [...advanced.notices];
        const expired = advanced.expired.map(toOrderView);
        const nowIso = this.ts();
        const symbols = this.symbolsInPlay(state);
        if (state.blocked) {
            return { tradeDate: state.tradeDate, filled: [], expired, notices: [...notices, '账户已锁定，已跳过撮合'] };
        }
        const contracts = await this.ensureContracts(state.tradeDate);
        const tradable = symbols.filter(symbol => {
            const sessions = daySessionsFor(contracts.map.get(symbol));
            return phaseAt(nowIso, state.tradeDate, sessions) === 'trading';
        });
        // Outside the day session (including right after the 15:30 settlement)
        // keep the close marks; a stale minute tick must not overwrite them.
        if (tradable.length === 0) {
            return { tradeDate: state.tradeDate, filled: [], expired, notices };
        }
        const quoteResult = await this.fetchQuoteMap(tradable);
        if (quoteResult.state !== 'ok') {
            if (quoteResult.notice !== undefined)
                notices.push(quoteResult.notice);
            return { tradeDate: state.tradeDate, filled: [], expired, notices };
        }
        await this.options.repo.markPrices([...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last })));
        const ticks = [...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last, tradable: true }));
        if (ticks.length === 0) {
            return { tradeDate: state.tradeDate, filled: [], expired, notices };
        }
        const outcome = await this.options.repo.transact(current => {
            if (current.blocked)
                return { events: [], value: { filled: [], notices: ['账户已锁定，已跳过撮合'] } };
            const result = engineTick(current, ticks, nowIso);
            return { events: result.events, value: { filled: result.filled, notices: result.notices } };
        });
        const marked = await this.options.repo.markPrices([...quoteResult.quotes].map(([symbol, quote]) => ({ symbol, last: quote.last })));
        return {
            tradeDate: marked.tradeDate,
            filled: outcome.value.filled.map(order => toOrderView(marked.orders[order.id] ?? order)),
            expired,
            notices: [...notices, ...outcome.value.notices],
        };
    }
    /** Wipe the account by replacing the ledger with one genesis event. */
    async reset(confirm) {
        if (confirm !== true)
            throw new FuturesError('INVALID_ARGUMENT', '重置需要 confirm=true', 400);
        const ts = this.ts();
        await this.options.repo.backup(ts);
        const previous = await this.options.repo.current().catch(error => {
            this.options.logger?.warn(`paper-trading: futures reset could not replay the old ledger: ${String(error)}`);
            return undefined;
        });
        const settings = previous !== undefined && previous.tradeDate !== ''
            ? normalizeFuturesSettings(previous.settings)
            : this.settings;
        // A reset restarts the glass on the current trade date: reusing a stale
        // trade date would force a chain of empty settlements after the reset.
        const tradeDate = await this.tradeDateForNow(this.now());
        const genesis = resetAccount(emptyState(this.accountId), settings, tradeDate, ts, 'user');
        return this.viewOf(await this.options.repo.replace(genesis.events));
    }
    /** Exposed for tests: current equity in cents after advancing the clock. */
    async equityCents() {
        const state = await this.sync();
        const view = toAccountView(state);
        return Math.round(view.equity * 100);
    }
}
//# sourceMappingURL=futures-service.js.map