import { randomUUID } from 'node:crypto';
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } from '../contract.js';
import { cancelOrder, openAccount, resetAccount, submit, tick as engineTick } from '../core/engine.js';
import { todayTradeDate } from '../core/calendar.js';
import { toAccountView, toFillView, toOrderView, toReview, previewOrder } from '../core/views.js';
import { PaperError } from './errors.js';
/** Orchestrates the ledger, the data port and the clock. No IO of its own. */
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
        const state = await this.ensureAccount();
        return toAccountView(state);
    }
    async ensureAccount() {
        let state = await this.options.repo.current();
        if (state.tradeDate === '') {
            const ts = this.ts();
            const { events } = openAccount(state, this.settings, todayTradeDate(this.now()), ts, this.accountId);
            state = await this.options.repo.append(events);
        }
        return state;
    }
    /** Symbols whose price the account cares about: open orders and held positions. */
    symbolsInPlay(state) {
        const symbols = new Set();
        for (const order of Object.values(state.orders))
            if (order.status === 'pending')
                symbols.add(order.symbol);
        for (const position of Object.values(state.positions))
            symbols.add(position.symbol);
        return [...symbols];
    }
    /**
     * Fetch quotes once and normalise failures into the port's four-state result,
     * so every caller (preview, place, tick, rollover) reports the same shape.
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
    async rollover() {
        let state = await this.options.repo.current();
        const today = todayTradeDate(this.now());
        if (state.tradeDate !== '' && today > state.tradeDate) {
            const quotes = await this.fetchQuotes(this.symbolsInPlay(state));
            const result = engineTick(state, quotes.quotes, this.ts());
            state = await this.options.repo.append(result.events);
            if (result.notices.length > 0)
                this.options.logger?.warn(result.notices.join('；'));
        }
        return state;
    }
    async quoteFor(draft) {
        const result = await this.fetchQuotes([draft.symbol]);
        if (result.quotes.length > 0)
            return result.quotes[0];
        if (draft.price !== undefined && draft.price > 0) {
            const ts = this.ts();
            return {
                symbol: draft.symbol,
                last: draft.price,
                bid: draft.price,
                ask: draft.price,
                ts,
                source: 'manual',
            };
        }
        return null;
    }
    async preview(draft) {
        const state = await this.ensureAccount();
        const quote = await this.quoteFor(draft);
        return previewOrder(state, draft, quote, state.settings);
    }
    async place(draft, requestId = randomUUID()) {
        let state = await this.rollover();
        state = await this.ensureAccount();
        const duplicate = Object.values(state.orders).find(order => order.requestId === requestId);
        if (duplicate !== undefined)
            return toOrderView(duplicate);
        const quote = await this.quoteFor(draft);
        const result = submit(state, draft, quote, requestId, this.ts());
        state = await this.options.repo.append(result.events);
        if (state.blocked)
            throw new PaperError('ACCOUNT_BLOCKED', '账户已锁定，请重置后继续', 409);
        const order = result.order === undefined ? undefined : state.orders[result.order.id];
        if (order === undefined)
            throw new PaperError('INTERNAL', '订单未写入账本');
        return toOrderView(order);
    }
    async cancel(orderId) {
        const state = await this.options.repo.current();
        if (state.blocked)
            throw new PaperError('ACCOUNT_BLOCKED', '账户已锁定，请重置后继续', 409);
        if (state.orders[orderId] === undefined)
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        const result = cancelOrder(state, orderId, this.ts());
        if (result.events.length === 0) {
            const existing = state.orders[orderId];
            if (existing !== undefined && existing.status !== 'pending') {
                throw new PaperError('ORDER_NOT_PENDING', '订单不是挂单状态', 409);
            }
            throw new PaperError('ORDER_NOT_FOUND', '订单不存在', 404);
        }
        const next = await this.options.repo.append(result.events);
        return toOrderView(next.orders[orderId]);
    }
    async tick() {
        const state = await this.rollover();
        const result = await this.fetchQuotes(this.symbolsInPlay(state));
        const ticked = engineTick(state, result.quotes, this.ts());
        const next = await this.options.repo.append(ticked.events);
        const marked = await this.options.repo.markPrices(result.quotes);
        return {
            tradeDate: marked.tradeDate,
            filled: ticked.filled.map(order => toOrderView(next.orders[order.id] ?? order)),
            expired: ticked.expired.map(order => toOrderView(next.orders[order.id] ?? order)),
            quotes: result.quotes,
            notices: [...ticked.notices, ...(result.notice === undefined ? [] : [result.notice])],
        };
    }
    async orders() {
        const state = await this.ensureAccount();
        return Object.values(state.orders)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(toOrderView);
    }
    async trades() {
        const state = await this.ensureAccount();
        return [...state.fills].reverse().map(toFillView);
    }
    async review(period = '30d') {
        const state = await this.ensureAccount();
        return toReview(state, period, todayTradeDate(this.now()));
    }
    async quote(symbols) {
        return this.fetchQuotes(symbols);
    }
    async bars(symbol, limit = 60) {
        try {
            return await this.options.data.dailyBars(symbol, Math.min(Math.max(1, limit), 250));
        }
        catch (error) {
            this.options.logger?.warn(`paper-trading: bars failed: ${String(error)}`);
            return { state: 'failed', bars: [], notice: String(error) };
        }
    }
    async settingsView() {
        const state = await this.ensureAccount();
        return state.settings;
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
        return toAccountView(await this.options.repo.append(result.events));
    }
}
//# sourceMappingURL=paper-service.js.map