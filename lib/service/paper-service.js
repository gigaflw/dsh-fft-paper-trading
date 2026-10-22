import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } from '../contract.js';
import { cancelOrder, closeDay, equityCents, openAccount, openDay, preOpenDay, releaseQueued, submit, tick as engineTick } from '../core/engine.js';
import { addDays, todayTradeDate, tradeDateOf } from '../core/calendar.js';
import { canMatch, canSubmit, isoAtShanghai, sessionPhaseAt } from '../core/session.js';
import { m2Settings } from '../core/settings.js';
import { prevCloseFromBars } from '../core/price-limit.js';
import { roundPrice } from '../core/money.js';
import { estimatePrice } from '../core/risk.js';
import { toAccountView, toFillView, toOrderView, toReview, previewOrder } from '../core/views.js';
import { PaperError } from './errors.js';
/** Why the account is locked, flattened to one readable line. */
function reasonText(reason, limit = 120) {
    if (reason === undefined || reason === '')
        return '';
    const flat = reason.replace(/\s+/g, ' ').trim();
    return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}
/** Orchestrates the ledger, the data port, the calendar and the clock. No IO of its own. */
export class PaperService {
    options;
    settings;
    accountId;
    now;
    constructor(options) {
        this.options = options;
        this.settings = m2Settings(options.settings ?? DEFAULT_SETTINGS);
        this.accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
        this.now = options.now ?? (() => new Date());
    }
    ts() {
        return this.now().toISOString();
    }
    /** Attach the on-disk location so a locked account is repairable from a reply. */
    viewOf(state) {
        const view = toAccountView(state);
        const path = this.options.repo.ledgerPath;
        return path === undefined ? view : { ...view, ledgerPath: path };
    }
    /** The single place that turns a blocked state into an error carrying its reason. */
    blocked(state) {
        const reason = reasonText(state.blockedReason);
        return new PaperError('ACCOUNT_BLOCKED', `账户已锁定，请重置后继续${reason === '' ? '' : `（${reason}）`}`, 409);
    }
    async account() {
        return this.viewOf(await this.sync());
    }
    /** Open the account on first use, through the store transaction. */
    async ensureAccount() {
        const outcome = await this.options.repo.transact(async (state) => {
            if (state.tradeDate !== '')
                return { events: [], value: undefined };
            const now = this.now();
            const tradeDate = await this.tradeDateForNow();
            const result = openAccount(state, this.settings, tradeDate, now.toISOString(), this.accountId);
            return { events: result.events, value: undefined };
        });
        return outcome.state;
    }
    /** Open if needed, then advance the clock; every public read uses this. */
    async sync() {
        await this.ensureAccount();
        return this.advanceTo();
    }
    async tradeDateForNow() {
        const today = todayTradeDate(this.now());
        return (await this.options.calendar.isTradingDay(today)) ? today : this.options.calendar.nextTradingDay(today);
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
    /**
     * Build the close events for one trade date. Data is fetched here; the
     * enclosing store transaction owns the append, so a concurrent read cannot
     * build the same snapshot twice.
     */
    async buildClose(state, date, next, nowIso) {
        if (this.hasClosed(state, date))
            return { events: [], state };
        const at = isoAtShanghai(date, 15 * 60);
        const live = await this.fetchQuotes(this.symbolsInPlay(state));
        const boundary = await this.boundaryQuotes(state, date, 'close', live.quotes);
        return closeDay(state, {
            date,
            nextTradeDate: next,
            ts: at,
            recordedAt: nowIso,
            quotes: boundary.quotes,
            closeSource: boundary.source,
        });
    }
    buildPreOpen(state, date) {
        if (state.tradeDate === date)
            return { events: [], state };
        return preOpenDay(state, date, isoAtShanghai(date, 9 * 60 + 15));
    }
    async buildOpen(state, date, nowIso) {
        if (state.lastOpenedDate === date)
            return { events: [], state };
        const at = isoAtShanghai(date, 9 * 60 + 30);
        const live = await this.fetchQuotes(this.symbolsInPlay(state));
        const boundary = await this.boundaryQuotes(state, date, 'open', live.quotes);
        return openDay(state, { date, ts: at, recordedAt: nowIso, quotes: boundary.quotes });
    }
    /**
     * Idempotent clock advance: close every due trade date and open the next one.
     *
     * The whole advance runs as one store transaction. Concurrent readers queue
     * behind it, so the day-boundary events are generated exactly once and the
     * `seq` values stay contiguous. Missed sessions produce snapshots only, never
     * fills.
     */
    async advanceTo() {
        const outcome = await this.options.repo.transact(async (state) => {
            if (state.tradeDate === '' || state.blocked)
                return { events: [], value: undefined };
            const now = this.now();
            const nowIso = now.toISOString();
            const today = todayTradeDate(now);
            let current = state;
            const events = [];
            const apply = (result) => {
                events.push(...result.events);
                current = result.state;
            };
            for (let guard = 0; guard < 400; guard += 1) {
                if (current.tradeDate < today) {
                    const next = await this.options.calendar.nextTradingDay(current.tradeDate);
                    if (nowIso >= isoAtShanghai(current.tradeDate, 15 * 60)) {
                        if (!this.hasClosed(current, current.tradeDate))
                            apply(await this.buildClose(current, current.tradeDate, next, nowIso));
                    }
                    if (nowIso >= isoAtShanghai(next, 9 * 60 + 15))
                        apply(this.buildPreOpen(current, next));
                    if (nowIso < isoAtShanghai(next, 9 * 60 + 30))
                        break;
                    apply(await this.buildOpen(current, next, nowIso));
                    continue;
                }
                if (current.tradeDate === today) {
                    if (await this.options.calendar.isTradingDay(today)) {
                        if (nowIso >= isoAtShanghai(today, 9 * 60 + 30) && current.lastOpenedDate !== today) {
                            apply(await this.buildOpen(current, today, nowIso));
                        }
                        if (nowIso >= isoAtShanghai(today, 15 * 60) && !this.hasClosed(current, today)) {
                            const next = await this.options.calendar.nextTradingDay(today);
                            apply(await this.buildClose(current, today, next, nowIso));
                        }
                    }
                }
                break;
            }
            return { events, value: undefined };
        });
        return outcome.state;
    }
    /**
     * Quote for a draft, with `prevClose` recovered from the daily bars.
     *
     * FTShare's single-symbol quote has no `prevClose`, so without this the price
     * limit is unknown and an order far outside the band would pass risk.
     */
    async quoteFor(draft) {
        const result = await this.fetchQuotes([draft.symbol]);
        const live = result.quotes[0];
        // A zero last price is unusable under M2; treat it as "no quote" so a market
        // order is rejected or falls back to the manual reference, never left resting.
        if (live !== undefined && Number.isFinite(live.last) && live.last > 0)
            return this.withPrevClose(live);
        if (draft.price !== undefined && draft.price > 0) {
            const fetchedAt = this.ts();
            return this.withPrevClose({
                symbol: draft.symbol,
                last: roundPrice(draft.price),
                marketTs: fetchedAt,
                fetchedAt,
                source: 'manual',
            });
        }
        return null;
    }
    async withPrevClose(quote) {
        if (quote.prevClose !== undefined && Number.isFinite(quote.prevClose) && quote.prevClose > 0)
            return quote;
        const prevClose = await this.prevCloseFor(quote.symbol);
        return prevClose === undefined ? quote : { ...quote, prevClose };
    }
    async prevCloseFor(symbol) {
        try {
            const bars = await this.options.data.dailyBars(symbol, 8);
            if (bars.state !== 'ok' || bars.bars.length === 0)
                return undefined;
            return prevCloseFromBars(bars.bars, todayTradeDate(this.now()));
        }
        catch {
            return undefined;
        }
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
        const state = await this.sync();
        const quote = await this.quoteFor(draft);
        // A limit order without a usable price is an unfinished draft, not a
        // 0.00 order; the ticket shows the field it is still missing instead.
        // (A market order without any quote keeps its warning, so the tool and the
        // panel can still explain what the user must fill in.)
        if (draft.type === 'limit' && estimatePrice(draft, quote) === null) {
            throw new PaperError('INVALID_ARGUMENT', '限价单必须给出正的限价', 400);
        }
        return previewOrder(state, draft, quote, state.settings, this.marketStatusAt(state, this.ts()));
    }
    async place(draft, requestId = randomUUID()) {
        const state = await this.sync();
        // A locked account must answer with the lock (and its reason) even when the
        // order would also fail the session gate; the repair path comes first.
        if (state.blocked)
            throw this.blocked(state);
        const now = this.ts();
        const phase = sessionPhaseAt(now);
        const matchable = canMatch(phase);
        if (!canSubmit(phase, draft.type)) {
            throw new PaperError(phase === 'closed' ? 'SESSION_CLOSED' : 'AUCTION_ONLY', draft.type === 'market' ? '当前时段不接受市价单，请改限价预埋' : '当前时段不接受委托', 409);
        }
        const quote = await this.quoteFor(draft);
        const tradeDate = await this.orderDateFor(state, now, phase);
        const outcome = await this.options.repo.transact(current => {
            const duplicate = Object.values(current.orders).find(order => order.requestId === requestId);
            if (duplicate !== undefined)
                return { events: [], value: { duplicateId: duplicate.id } };
            if (current.blocked)
                return { events: [], value: { blocked: true } };
            const result = submit(current, { ...draft, name: quote?.name, tradeDate }, quote, requestId, now, {
                matchable,
                phase,
            });
            return { events: result.events, value: { orderId: result.order?.id } };
        });
        if (outcome.value.duplicateId !== undefined) {
            const duplicate = outcome.state.orders[outcome.value.duplicateId];
            if (duplicate === undefined)
                throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
            return toOrderView(duplicate);
        }
        if (outcome.value.blocked === true || outcome.state.blocked) {
            throw this.blocked(outcome.state);
        }
        const order = outcome.value.orderId === undefined ? undefined : outcome.state.orders[outcome.value.orderId];
        if (order === undefined)
            throw new PaperError('INTERNAL', '订单未写入账本');
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
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        if (outcome.value.notPending === true)
            throw new PaperError('ORDER_NOT_PENDING', '订单不是挂单状态', 409);
        const order = outcome.state.orders[orderId];
        if (order === undefined)
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        return toOrderView(order);
    }
    async tick() {
        const state = await this.sync();
        const now = this.ts();
        const phase = sessionPhaseAt(now);
        const symbols = this.symbolsInPlay(state);
        const quotes = await this.fetchQuotes(symbols);
        if (!canMatch(phase)) {
            await this.options.repo.markPrices(quotes.quotes);
            return { tradeDate: state.tradeDate, filled: [], expired: [], quotes: quotes.quotes, notices: quotes.notice === undefined ? [] : [quotes.notice] };
        }
        const outcome = await this.options.repo.transact(current => {
            if (current.blocked) {
                const reason = reasonText(current.blockedReason);
                return { events: [], value: { filled: [], expired: [], notices: [`账户已锁定，已跳过撮合${reason === '' ? '' : `（${reason}）`}`] } };
            }
            const released = releaseQueued(current, now, current.tradeDate);
            const ticked = engineTick(released.state, quotes.quotes, now);
            return {
                events: [...released.events, ...ticked.events],
                value: { filled: ticked.filled, expired: ticked.expired, notices: ticked.notices },
            };
        });
        const marked = await this.options.repo.markPrices(quotes.quotes);
        return {
            tradeDate: marked.tradeDate,
            filled: outcome.value.filled.map(order => toOrderView(marked.orders[order.id] ?? order)),
            expired: outcome.value.expired.map(order => toOrderView(marked.orders[order.id] ?? order)),
            quotes: quotes.quotes,
            notices: [...outcome.value.notices, ...(quotes.notice === undefined ? [] : [quotes.notice])],
        };
    }
    async orders() {
        const state = await this.sync();
        return Object.values(state.orders)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(toOrderView);
    }
    async trades() {
        const state = await this.sync();
        return [...state.fills].reverse().map(toFillView);
    }
    async review(period = '30d') {
        const state = await this.sync();
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
    async watchlist() {
        return this.options.watchlist?.read() ?? [];
    }
    async setWatchlist(symbols) {
        if (this.options.watchlist === undefined)
            throw new PaperError('INVALID_ARGUMENT', '自选存储不可用', 503);
        return this.options.watchlist.write(symbols);
    }
    async settingsView() {
        const state = await this.sync();
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
        const state = await this.sync();
        return this.marketStatusAt(state, this.ts());
    }
    async cashFlow() {
        const state = await this.sync();
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
        const state = await this.sync();
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
                gaps: point.gaps ?? {},
                closeSource: point.closeSource ?? 'missing',
            });
            previous = point.equityCents;
        }
        return reports;
    }
    async roundtrips() {
        const state = await this.sync();
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
     * Wipe the account by replacing the ledger with one genesis event.
     *
     * The old file is copied aside first, *before* replay is trusted: a ledger
     * that currently blocks the account (duplicate seq, NaN fill) must still be
     * resettable/exportable. Settings come from the persisted account merged over
     * the current defaults, so a legacy account does not inherit its missing
     * fields. The write is an atomic temp-file rename.
     */
    async reset(confirm) {
        if (confirm !== true)
            throw new PaperError('INVALID_ARGUMENT', '重置需要 confirm=true', 400);
        const ts = this.ts();
        await this.options.repo.backup(ts);
        const previous = await this.options.repo.current().catch(error => {
            this.options.logger?.warn(`paper-trading: reset could not replay the old ledger: ${String(error)}`);
            return undefined;
        });
        const settings = m2Settings(previous !== undefined && previous.tradeDate !== '' ? previous.settings : this.settings);
        const tradeDate = previous !== undefined && previous.tradeDate !== '' ? previous.tradeDate : await this.tradeDateForNow();
        const genesis = {
            seq: 1,
            id: 'evt-1',
            ts,
            type: 'account.reset',
            payload: { settings, initialCashCents: settings.initialCashCents, tradeDate, reason: 'user' },
        };
        const next = await this.options.repo.replace([genesis]);
        return this.viewOf(next);
    }
    /** Read-only export of the raw ledger, for a locked account's banner. */
    async exportLedger() {
        const ledger = await this.options.repo.readLedger();
        if (ledger.content === null)
            return { path: ledger.path, exists: false, notice: '账本文件尚未创建' };
        return { path: ledger.path, exists: true, content: ledger.content };
    }
    /**
     * Where the ledger is and why it is locked — without the raw text.
     *
     * `exportLedger` exists for downloading; this is the answer a human or an
     * agent needs to locate the file and name the failing invariant.
     */
    async ledgerStatus() {
        const ledger = await this.options.repo.readLedger();
        const state = await this.options.repo.current().catch(error => {
            this.options.logger?.warn(`paper-trading: ledger status could not replay: ${String(error)}`);
            return undefined;
        });
        return {
            path: ledger.path,
            exists: ledger.content !== null,
            blocked: state?.blocked === true,
            blockedReason: state?.blockedReason,
        };
    }
    /** Exposed for tests/scenarios: current equity in cents after advancing the clock. */
    async equityCents() {
        const state = await this.sync();
        return equityCents(state);
    }
}
//# sourceMappingURL=paper-service.js.map