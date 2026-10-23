import { PAPER_LEDGER_VERSION } from '../contract.js';
import { tradeDateOf } from './calendar.js';
import { amountCents } from './money.js';
import { computeFees } from './fees.js';
import { decideFill } from './matching.js';
import { checkOrder } from './risk.js';
import { applyEvent } from './ledger.js';
import { normalizeSettings } from './settings.js';
function clone(state) {
    return structuredClone(state);
}
/** Append one event with the next sequence number and fold it into `state`. */
function append(state, events, spec, ts) {
    const seq = state.lastSeq + 1;
    const event = { seq, id: `evt-${seq}`, ts, type: spec.type, payload: spec.payload };
    events.push(event);
    applyEvent(state, event);
    return event;
}
export function openAccount(state, settings, tradeDate, ts, accountId) {
    const working = clone(state);
    const events = [];
    const normalized = normalizeSettings(settings);
    append(working, events, {
        type: 'account.opened',
        payload: { accountId, settings: normalized, initialCashCents: normalized.initialCashCents, tradeDate, ledgerVersion: PAPER_LEDGER_VERSION },
    }, ts);
    return { events, state: working };
}
export function resetAccount(state, settings, tradeDate, ts, reason) {
    const working = clone(state);
    const events = [];
    const normalized = normalizeSettings(settings);
    append(working, events, {
        type: 'account.reset',
        payload: { settings: normalized, initialCashCents: normalized.initialCashCents, tradeDate, reason },
    }, ts);
    return { events, state: working };
}
/** One fill takes the whole remaining quantity: M2 never partially fills. */
export function fillQty(order) {
    const remaining = order.remainingQty;
    return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
}
/**
 * Move cash in (`deposit`) or out (`withdraw`) without touching positions.
 *
 * The amount is validated here rather than only in the service: it lands in the
 * ledger, where a zero, negative or fractional cent value would break replay.
 * A withdrawal larger than the free cash is a caller bug (the service checks it
 * inside the same transaction), so it throws instead of booking a negative cash.
 */
export function depositCash(state, amountCents, ts) {
    assertCashAmount(amountCents);
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'cash.deposit', payload: { amountCents, tradeDate: working.tradeDate } }, ts);
    return { events, state: working };
}
export function withdrawCash(state, amountCents, ts) {
    assertCashAmount(amountCents);
    if (amountCents > state.cashCents)
        throw new Error(`withdraw ${amountCents} exceeds cash ${state.cashCents}`);
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'cash.withdraw', payload: { amountCents, tradeDate: working.tradeDate } }, ts);
    return { events, state: working };
}
function assertCashAmount(amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error(`cash amount must be a positive integer of cents, got ${String(amountCents)}`);
    }
}
function makeFill(state, order, price, qty, ts, settings) {
    const amount = amountCents(price, qty);
    const index = state.fills.filter(item => item.orderId === order.id).length + 1;
    return {
        id: `fill-${order.id}-${index}`,
        orderId: order.id,
        symbol: order.symbol,
        name: order.name,
        side: order.side,
        price,
        qty,
        amountCents: amount,
        fees: computeFees(amount, order.side, settings),
        ts,
        tradeDate: tradeDateOf(ts),
    };
}
/**
 * Submit one order. Risk runs before any event is written; a rejection is still
 * a ledger event. Orders accepted outside the matching phase are `queued` and
 * never fill until a later tick.
 */
export function submit(state, draft, quote, requestId, ts, options = { matchable: true }) {
    const working = clone(state);
    const events = [];
    const tradeDate = draft.tradeDate ?? tradeDateOf(ts);
    const order = {
        id: `ord-${tradeDate}-${state.lastSeq + 1}`,
        requestId,
        symbol: draft.symbol.trim(),
        name: draft.name ?? quote?.name,
        side: draft.side,
        type: draft.type,
        qty: draft.qty,
        limitPrice: draft.limitPrice,
        status: options.matchable ? 'pending' : 'queued',
        note: draft.note,
        phase: options.phase,
        createdAt: ts,
        updatedAt: ts,
        filledQty: 0,
        remainingQty: draft.qty,
        tradeDate,
    };
    const risk = checkOrder(working, draft, quote, working.settings, tradeDate);
    if (!risk.ok) {
        const rejected = { ...order, status: 'rejected', reason: `${risk.code}: ${risk.message}` };
        append(working, events, {
            type: 'order.rejected',
            payload: { order: rejected, reason: `${risk.code}: ${risk.message}` },
        }, ts);
        return { events, state: working, order: working.orders[rejected.id] };
    }
    append(working, events, { type: 'order.submitted', payload: { order, quote: quote ?? { ...emptyQuote(draft.symbol) }, phase: options.phase } }, ts);
    if (options.matchable && quote !== null) {
        const decision = decideFill(order, quote);
        if (decision.fill && decision.price !== undefined) {
            const qty = fillQty(order);
            if (qty > 0) {
                append(working, events, {
                    type: 'order.filled',
                    payload: { orderId: order.id, fill: makeFill(working, order, decision.price, qty, ts, working.settings) },
                }, ts);
            }
        }
    }
    return { events, state: working, order: working.orders[order.id] };
}
function emptyQuote(symbol) {
    return { symbol, last: 0, marketTs: null };
}
export function cancelOrder(state, orderId, ts) {
    const order = state.orders[orderId];
    if (order === undefined)
        return { events: [], state, order: undefined };
    if (order.status !== 'pending' && order.status !== 'queued' && order.status !== 'partially_filled') {
        return { events: [], state, order };
    }
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'order.canceled', payload: { orderId, reason: 'user', at: ts } }, ts);
    return { events, state: working, order: working.orders[orderId] };
}
/** Match resting orders against a fresh quote. Day expiry is handled by closeDay. */
export function tick(state, quotes, ts) {
    const working = clone(state);
    const events = [];
    const filled = [];
    const expired = [];
    const notices = [];
    const quoteMap = new Map(quotes.map(quote => [quote.symbol, quote]));
    for (const quote of quotes) {
        const position = working.positions[quote.symbol];
        if (position !== undefined) {
            position.lastPrice = quote.last;
            position.lastTs = quote.marketTs ?? ts;
        }
    }
    for (const order of Object.values(working.orders)) {
        if (order.status !== 'pending' && order.status !== 'partially_filled')
            continue;
        const quote = quoteMap.get(order.symbol);
        if (quote === undefined)
            continue;
        const decision = decideFill(order, quote);
        if (!decision.fill || decision.price === undefined)
            continue;
        if (order.side === 'buy') {
            const amount = amountCents(decision.price, order.remainingQty);
            const fees = computeFees(amount, 'buy', working.settings);
            if (working.cashCents < amount + fees.totalCents) {
                append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_cash', at: ts } }, ts);
                notices.push(`${order.symbol} 挂单因资金不足取消`);
                continue;
            }
        }
        else {
            const position = working.positions[order.symbol];
            if (position === undefined || position.available < order.remainingQty) {
                append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'insufficient_position', at: ts } }, ts);
                notices.push(`${order.symbol} 挂单因可卖不足取消`);
                continue;
            }
        }
        const qty = fillQty(order);
        if (qty <= 0)
            continue;
        append(working, events, {
            type: 'order.filled',
            payload: { orderId: order.id, fill: makeFill(working, order, decision.price, qty, ts, working.settings) },
        }, ts);
        filled.push(working.orders[order.id]);
    }
    return { events, state: working, filled, expired, notices };
}
/** Promote queued orders once continuous matching is available again (e.g. 13:00). */
export function releaseQueued(state, ts, tradeDate) {
    const working = clone(state);
    const events = [];
    for (const order of Object.values(working.orders)) {
        if (order.status !== 'queued')
            continue;
        if (tradeDate !== undefined && order.tradeDate !== tradeDate)
            continue;
        append(working, events, { type: 'order.released', payload: { orderId: order.id, at: ts } }, ts);
    }
    return { events, state: working };
}
/** Close one trade date: snapshot, day-order expiry. T+1 stays for the next open. */
export function closeDay(state, options) {
    const working = clone(state);
    const events = [];
    const closePrices = {};
    for (const quote of options.quotes)
        closePrices[quote.symbol] = quote.last;
    const positions = Object.values(working.positions).map(position => ({
        symbol: position.symbol,
        name: position.name,
        qty: position.qty,
        available: position.available,
        costCents: position.costCents,
        lastPrice: position.lastPrice,
    }));
    for (const position of Object.values(working.positions)) {
        const close = closePrices[position.symbol];
        if (close !== undefined) {
            position.lastPrice = close;
            position.lastTs = options.ts;
        }
    }
    const feesCents = working.fills
        .filter(fill => fill.tradeDate === options.date)
        .reduce((sum, fill) => sum + fill.fees.totalCents, 0);
    const point = {
        date: options.date,
        equityCents: equityCents(working),
        cashCents: working.cashCents,
        nextDate: options.nextTradeDate,
        feesCents,
        closePrices,
        positions,
        gaps: working.gaps,
        closeSource: options.closeSource,
        recordedAt: options.recordedAt,
    };
    append(working, events, { type: 'day.closed', payload: point }, options.ts);
    for (const order of Object.values(working.orders)) {
        if (order.tradeDate !== options.date)
            continue;
        if (order.status !== 'pending' && order.status !== 'queued' && order.status !== 'partially_filled')
            continue;
        append(working, events, { type: 'order.canceled', payload: { orderId: order.id, reason: 'expired', at: options.ts } }, options.ts);
    }
    return { events, state: working };
}
/** Switch to the new trade date at 09:15 without unlocking T+1. */
export function preOpenDay(state, date, ts) {
    const working = clone(state);
    const events = [];
    append(working, events, { type: 'day.pre_opened', payload: { date, at: ts } }, ts);
    return { events, state: working };
}
/** Open a trade date: advance tradeDate, snapshot opens/gaps, unlock T+1. */
export function openDay(state, options) {
    const working = clone(state);
    const events = [];
    const openPrices = {};
    const prevClose = {};
    const gaps = {};
    for (const quote of options.quotes) {
        openPrices[quote.symbol] = quote.last;
        if (quote.prevClose !== undefined) {
            prevClose[quote.symbol] = quote.prevClose;
            gaps[quote.symbol] = quote.prevClose > 0 ? (quote.last - quote.prevClose) / quote.prevClose : 0;
        }
    }
    const payload = {
        date: options.date,
        openPrices,
        prevClose,
        gaps,
        t1Unlocked: working.settings.enableT1,
        recordedAt: options.recordedAt,
    };
    append(working, events, { type: 'day.opened', payload }, options.ts);
    for (const order of Object.values(working.orders)) {
        if (order.status === 'queued' && order.tradeDate === options.date) {
            append(working, events, { type: 'order.released', payload: { orderId: order.id, at: options.ts } }, options.ts);
        }
    }
    return { events, state: working };
}
/** Mark-to-market equity in cents; falls back to cost basis when no price is known. */
export function equityCents(state) {
    let market = 0;
    for (const position of Object.values(state.positions)) {
        market += position.lastPrice === undefined
            ? position.costCents
            : amountCents(position.lastPrice, position.qty);
    }
    return state.cashCents + market;
}
//# sourceMappingURL=engine.js.map