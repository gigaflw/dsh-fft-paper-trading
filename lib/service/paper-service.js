import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } from '../contract.js';
import { cancelOrder, closeDay, equityCents, openAccount, openDay, resetAccount, submit, tick as engineTick } from '../core/engine.js';
import { addDays, todayTradeDate, tradeDateOf } from '../core/calendar.js';
import { canMatch, canSubmit, isoAtShanghai, sessionPhaseAt } from '../core/session.js';
import { toAccountView, toFillView, toOrderView, toReview, previewOrder } from '../core/views.js';
import { PaperError } from './errors.js';
/** Orchestrates the ledger, the data port, the calendar and the clock. No IO of its own. */
export class PaperService {
    options;
    settings;
    accountId;
    now;
    constructor(options) {
        this.options = options;
        this.settings = options.settings ?? DEFAULT_SETTINGS;
        this.accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
        this.now = options.now ?? (() => new Date());
    }
    ts() {
        return this.now().toISOString();
    }
    async account() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return toAccountView(state);
    }
    async ensureAccount() {
        let state = await this.options.repo.current();
        if (state.tradeDate === '') {
            const now = this.now();
            const today = todayTradeDate(now);
            const tradeDate = (await this.options.calendar.isTradingDay(today))
                ? today
                : await this.options.calendar.nextTradingDay(today);
            const { events } = openAccount(state, this.settings, tradeDate, now.toISOString(), this.accountId);
            state = await this.options.repo.append(events);
        }
        return state;
    }
    /** Symbols whose price the account cares about: open orders and held positions. */
    symbolsInPlay(state) {
        const symbols = new Set();
        for (const order of Object.values(state.orders)) {
            if (order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled')
                symbols.add(order.symbol);
        }
        for (const position of Object.values(state.positions))
            symbols.add(position.symbol);
        return [...symbols];
    }
    /**
     * Fetch quotes once and normalise failures into the port's four-state result,
     * so every caller (preview, place, tick, day boundaries) reports the same shape.
     */
    async fetchQuotes(symbols) {
        if (symbols.length === 0)
            return { state: 'ok', quotes: [] };
        try {
            return await this.options.data.quotes([...symbols]);
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: quote refresh failed: ${String(error)}`);
            return { state: 'failed', quotes: [], notice: String(error) };
        }
    }
    async fetchBars(symbols, limit = 10) {
        const result = new Map();
        for (const symbol of symbols) {
            try {
                const bars = await this.options.data.dailyBars(symbol, limit);
                if (bars.state === 'ok' && bars.bars.length > 0)
                    result.set(symbol, bars.bars);
            }
            catch {
                // best effort: boundary snapshots fall back to the live quote
            }
        }
        return result;
    }
    async boundaryQuotes(state, date, mode, fallback) {
        const symbols = this.symbolsInPlay(state);
        if (symbols.length === 0)
            return { quotes: [], source: 'daily' };
        const bars = await this.fetchBars(symbols, 12);
        const live = new Map(fallback.map(quote => [quote.symbol, quote]));
        let usedDaily = 0;
        const quotes = [];
        for (const symbol of symbols) {
            const list = bars.get(symbol) ?? [];
            const bar = list.find(item => tradeDateOf(item.time) === date);
            const liveQuote = live.get(symbol);
            if (bar !== undefined) {
                const index = list.indexOf(bar);
                const previous = index > 0 ? list[index - 1] : undefined;
                quotes.push({
                    symbol,
                    name: liveQuote?.name,
                    last: mode === 'open' ? bar.open : bar.close,
                    prevClose: previous?.close ?? liveQuote?.prevClose,
                    marketTs: bar.time,
                    fetchedAt: this.ts(),
                    source: 'daily-bar',
                });
                usedDaily += 1;
            }
            else if (liveQuote !== undefined) {
                quotes.push(liveQuote);
            }
        }
        const source = usedDaily === symbols.length ? 'daily' : quotes.length > 0 ? 'last' : 'missing';
        return { quotes, source };
    }
    hasClosed(state, date) {
        return state.dayEquity.some(point => point.date === date);
    }
    async runClose(state, date, next, nowIso) {
        if (this.hasClosed(state, date))
            return state;
        const at = isoAtShanghai(date, 15 * 60);
        const live = await this.fetchQuotes(this.symbolsInPlay(state));
        const boundary = await this.boundaryQuotes(state, date, 'close', live.quotes);
        const result = closeDay(state, {
            date,
            nextTradeDate: next,
            ts: at,
            recordedAt: nowIso,
            quotes: boundary.quotes,
            closeSource: boundary.source,
        });
        if (result.events.length > 0)
            await this.options.repo.append(result.events);
        return result.state;
    }
    async runOpen(state, date, nowIso) {
        if (state.lastOpenedDate === date)
            return state;
        const at = isoAtShanghai(date, 9 * 60 + 30);
        const live = await this.fetchQuotes(this.symbolsInPlay(state));
        const boundary = await this.boundaryQuotes(state, date, 'open', live.quotes);
        const result = openDay(state, { date, ts: at, recordedAt: nowIso, quotes: boundary.quotes });
        if (result.events.length > 0)
            await this.options.repo.append(result.events);
        return result.state;
    }
    /**
     * Idempotent clock advance: close every due trade date and open the next one.
     * Missed sessions produce snapshots only, never fills.
     */
    async advanceTo(state) {
        if (state.tradeDate === '')
            return state;
        const now = this.now();
        const nowIso = now.toISOString();
        const today = todayTradeDate(now);
        let current = state;
        for (let guard = 0; guard < 400; guard += 1) {
            if (current.tradeDate < today) {
                const next = await this.options.calendar.nextTradingDay(current.tradeDate);
                if (nowIso >= isoAtShanghai(current.tradeDate, 15 * 60)) {
                    current = await this.runClose(current, current.tradeDate, next, nowIso);
                }
                if (nowIso < isoAtShanghai(next, 9 * 60 + 30))
                    break;
                current = await this.runOpen(current, next, nowIso);
                continue;
            }
            if (current.tradeDate === today) {
                if (await this.options.calendar.isTradingDay(today)) {
                    if (nowIso >= isoAtShanghai(today, 9 * 60 + 30) && current.lastOpenedDate !== today) {
                        current = await this.runOpen(current, today, nowIso);
                    }
                    if (nowIso >= isoAtShanghai(today, 15 * 60) && !this.hasClosed(current, today)) {
                        const next = await this.options.calendar.nextTradingDay(today);
                        current = await this.runClose(current, today, next, nowIso);
                    }
                }
            }
            break;
        }
        return current;
    }
    async quoteFor(draft) {
        const result = await this.fetchQuotes([draft.symbol]);
        if (result.quotes.length > 0)
            return result.quotes[0];
        if (draft.price !== undefined && draft.price > 0) {
            const fetchedAt = this.ts();
            return {
                symbol: draft.symbol,
                last: draft.price,
                marketTs: fetchedAt,
                fetchedAt,
                source: 'manual',
            };
        }
        return null;
    }
    async volumeFor(symbols, date) {
        const volumes = {};
        for (const symbol of symbols) {
            try {
                const bars = await this.options.data.minuteBars(symbol, date);
                if (bars.state === 'ok' && bars.bars.length > 0) {
                    const bar = bars.bars[bars.bars.length - 1];
                    if (bar.volume !== undefined && tradeDateOf(bar.time) === date)
                        volumes[symbol] = bar.volume;
                }
            }
            catch {
                // no volume → unlimited fill model
            }
        }
        return volumes;
    }
    async orderDateFor(state, nowIso, phase = sessionPhaseAt(nowIso)) {
        const today = todayTradeDate(this.now());
        if (state.tradeDate > today)
            return state.tradeDate;
        if (state.tradeDate < today)
            return this.options.calendar.nextTradingDay(state.tradeDate);
        // After the close, a new order is pre-planted for the next trade date.
        if (phase === 'closed' && nowIso >= isoAtShanghai(today, 15 * 60)) {
            return this.options.calendar.nextTradingDay(state.tradeDate);
        }
        return state.tradeDate;
    }
    async preview(draft) {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        const quote = await this.quoteFor(draft);
        return previewOrder(state, draft, quote, state.settings, this.marketStatusAt(state, this.ts()));
    }
    async place(draft, requestId = randomUUID()) {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        const phase = sessionPhaseAt(this.ts());
        const matchable = canMatch(phase);
        if (!canSubmit(phase, draft.type)) {
            throw new PaperError(phase === 'closed' ? 'SESSION_CLOSED' : 'AUCTION_ONLY', draft.type === 'market' ? '当前时段不接受市价单，请改限价预埋' : '当前时段不接受委托', 409);
        }
        const duplicate = Object.values(state.orders).find(order => order.requestId === requestId);
        if (duplicate !== undefined)
            return toOrderView(duplicate);
        const quote = await this.quoteFor(draft);
        const tradeDate = await this.orderDateFor(state, this.ts(), phase);
        const volumes = matchable ? await this.volumeFor([draft.symbol], tradeDate) : {};
        const barTs = quote?.marketTs ?? undefined;
        const result = submit(state, { ...draft, name: quote?.name, tradeDate }, quote, requestId, this.ts(), {
            matchable,
            phase,
            barVolume: volumes[draft.symbol],
            barTs: barTs ?? undefined,
        });
        state = await this.options.repo.append(result.events);
        if (state.blocked)
            throw new PaperError('ACCOUNT_BLOCKED', '账户已锁定，请重置后继续', 409);
        const order = result.order === undefined ? undefined : state.orders[result.order.id];
        if (order === undefined)
            throw new PaperError('INTERNAL', '订单未写入账本');
        return toOrderView(order);
    }
    async cancel(orderId) {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        if (state.blocked)
            throw new PaperError('ACCOUNT_BLOCKED', '账户已锁定，请重置后继续', 409);
        if (state.orders[orderId] === undefined)
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        const result = cancelOrder(state, orderId, this.ts());
        if (result.events.length === 0) {
            const existing = state.orders[orderId];
            if (existing !== undefined && existing.status !== 'pending' && existing.status !== 'queued' && existing.status !== 'partially_filled') {
                throw new PaperError('ORDER_NOT_PENDING', '订单不是挂单状态', 409);
            }
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        }
        const next = await this.options.repo.append(result.events);
        return toOrderView(next.orders[orderId]);
    }
    async tick() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        const now = this.ts();
        const phase = sessionPhaseAt(now);
        const symbols = this.symbolsInPlay(state);
        const quotes = await this.fetchQuotes(symbols);
        if (!canMatch(phase)) {
            await this.options.repo.markPrices(quotes.quotes);
            return { tradeDate: state.tradeDate, filled: [], expired: [], quotes: quotes.quotes, notices: quotes.notice === undefined ? [] : [quotes.notice] };
        }
        const volumes = await this.volumeFor(symbols, state.tradeDate);
        const ticked = engineTick(state, quotes.quotes, now, volumes);
        const next = await this.options.repo.append(ticked.events);
        const marked = await this.options.repo.markPrices(quotes.quotes);
        return {
            tradeDate: marked.tradeDate,
            filled: ticked.filled.map(order => toOrderView(next.orders[order.id] ?? order)),
            expired: ticked.expired.map(order => toOrderView(next.orders[order.id] ?? order)),
            quotes: quotes.quotes,
            notices: [...ticked.notices, ...(quotes.notice === undefined ? [] : [quotes.notice])],
        };
    }
    async orders() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return Object.values(state.orders)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(toOrderView);
    }
    async trades() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return [...state.fills].reverse().map(toFillView);
    }
    async review(period = '30d') {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return toReview(state, period, todayTradeDate(this.now()));
    }
    async quote(symbols) {
        return this.fetchQuotes(symbols);
    }
    async dailyBars(symbol, limit = 60) {
        try {
            return await this.options.data.dailyBars(symbol, Math.min(Math.max(1, limit), 250));
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: bars failed: ${String(error)}`);
            return { state: 'failed', bars: [], notice: String(error) };
        }
    }
    async minuteBars(symbol, date) {
        try {
            return await this.options.data.minuteBars(symbol, date ?? todayTradeDate(this.now()));
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: minute bars failed: ${String(error)}`);
            return { state: 'failed', bars: [], notice: String(error) };
        }
    }
    async search(query, limit = 10) {
        return this.options.data.search(query, Math.min(Math.max(1, limit), 50));
    }
    async marketList(input = {}) {
        return this.options.data.marketList(input);
    }
    async settingsView() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return state.settings;
    }
    marketStatusAt(state, nowIso) {
        const phase = sessionPhaseAt(nowIso);
        return {
            phase,
            tradeDate: state.tradeDate,
            canSubmit: canSubmit(phase, 'limit'),
            canMatch: canMatch(phase),
            nextBoundary: this.nextBoundaryFor(nowIso),
        };
    }
    nextBoundaryFor(nowIso) {
        const phase = sessionPhaseAt(nowIso);
        const today = todayTradeDate(this.now());
        const at = (date, minutes) => isoAtShanghai(date, minutes);
        switch (phase) {
            case 'pre_open': return at(today, 9 * 60 + 30);
            case 'continuous_am': return at(today, 11 * 60 + 30);
            case 'lunch': return at(today, 13 * 60);
            case 'continuous_pm': return at(today, 14 * 60 + 57);
            case 'auction_close': return at(today, 15 * 60);
            default: return at(addDays(today, 1), 9 * 60 + 15);
        }
    }
    async marketStatus() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return this.marketStatusAt(state, this.ts());
    }
    async cashFlow() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        let balance = 0;
        const rows = [];
        rows.push({ ts: state.createdAt, type: 'open', amount: state.initialCashCents / 100, balance: state.initialCashCents / 100 });
        balance = state.initialCashCents;
        for (const fill of state.fills) {
            const gross = fill.side === 'buy' ? -(fill.amountCents + fill.fees.totalCents) : fill.amountCents - fill.fees.totalCents;
            balance += gross;
            rows.push({
                ts: fill.ts,
                type: fill.side === 'buy' ? 'buy' : 'sell',
                amount: gross / 100,
                balance: balance / 100,
                ref: fill.orderId,
            });
        }
        return rows;
    }
    async dailyReport(date) {
        const state = await this.ensureAccount();
        const points = date === undefined ? state.dayEquity : state.dayEquity.filter(point => point.date === date);
        let previous = state.initialCashCents;
        const reports = [];
        for (const point of state.dayEquity) {
            if (!points.includes(point)) {
                previous = point.equityCents;
                continue;
            }
            reports.push({
                date: point.date,
                equity: point.equityCents / 100,
                cash: point.cashCents / 100,
                dayPnl: (point.equityCents - previous) / 100,
                fees: (point.feesCents ?? 0) / 100,
                available: point.positions?.reduce((sum, position) => sum + position.available, 0) ?? 0,
                positions: (point.positions ?? []).map(position => ({
                    symbol: position.symbol,
                    name: position.name,
                    qty: position.qty,
                    available: position.available,
                    avgCost: position.qty > 0 ? position.costCents / position.qty / 100 : 0,
                    lastPrice: position.lastPrice,
                })),
                gaps: {},
                closeSource: point.closeSource ?? 'missing',
            });
            previous = point.equityCents;
        }
        return reports;
    }
    async roundtrips() {
        const state = await this.ensureAccount();
        const lots = new Map();
        const trips = new Map();
        for (const fill of state.fills) {
            const lot = lots.get(fill.symbol) ?? { qty: 0, cost: 0 };
            if (fill.side === 'buy') {
                lot.qty += fill.qty;
                lot.cost += fill.amountCents + fill.fees.totalCents;
                lot.openedAt ??= fill.ts;
                lots.set(fill.symbol, lot);
                continue;
            }
            const avg = lot.qty > 0 ? lot.cost / lot.qty : 0;
            const cost = Math.round(avg * fill.qty);
            lot.qty -= fill.qty;
            lot.cost -= cost;
            lots.set(fill.symbol, lot);
            const trip = trips.get(fill.symbol) ?? {
                symbol: fill.symbol,
                name: fill.name,
                qty: 0,
                cost: 0,
                proceeds: 0,
                pnl: 0,
                holdingDays: 0,
            };
            trip.qty += fill.qty;
            trip.cost += cost;
            trip.proceeds += fill.amountCents - fill.fees.totalCents;
            trip.pnl += fill.amountCents - fill.fees.totalCents - cost;
            if (lot.openedAt !== undefined) {
                trip.holdingDays = Math.max(trip.holdingDays, Math.round((Date.parse(fill.ts) - Date.parse(lot.openedAt)) / 86_400_000));
            }
            trips.set(fill.symbol, trip);
        }
        return [...trips.values()].map(trip => ({
            ...trip,
            cost: trip.cost / 100,
            proceeds: trip.proceeds / 100,
            pnl: trip.pnl / 100,
        }));
    }
    /**
     * Wipe the account while keeping its current settings. The reset command goes
     * through the same append path as every other command, so the ledger still
     * verifies and the pre-reset file is copied aside first.
     */
    async reset(confirm) {
        if (confirm !== true)
            throw new PaperError('INVALID_ARGUMENT', '重置需要 confirm=true', 400);
        const state = await this.options.repo.current();
        const ts = this.ts();
        await this.options.repo.backup(ts);
        const settings = state.tradeDate === '' ? this.settings : state.settings;
        const tradeDate = state.tradeDate || todayTradeDate(this.now());
        const result = resetAccount(state, settings, tradeDate, ts, 'user');
        const next = await this.options.repo.append(result.events);
        return toAccountView(next);
    }
    /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
    async equityCents() {
        let state = await this.ensureAccount();
        state = await this.advanceTo(state);
        return equityCents(state);
    }
}
//# sourceMappingURL=paper-service.js.map