import { amountCents, roundPrice } from './money.js';
import { computeFees } from './fees.js';
import { isWithinLimit, priceLimitFor } from './price-limit.js';
/**
 * The price used by risk, preview and the submit path.
 *
 * M2 executes at the quote's last price, so a market order estimates at `last`.
 * A limit order estimates at the price it would actually trade at: `last` once
 * the limit is crossed, otherwise the limit itself — the most a buy can pay or
 * the least a sell can receive while it rests. That keeps the cash check honest
 * (a resting 10.00 bid is not charged the 11.29 last) and still makes the
 * preview agree with the fill whenever the order can fill right now. Without a
 * quote the limit, then the manual reference price, are the only sources.
 */
export function estimatePrice(draft, quote) {
    const last = quote !== null && Number.isFinite(quote.last) && quote.last > 0 ? roundPrice(quote.last) : null;
    if (draft.type === 'market') {
        if (last !== null)
            return last;
        return draft.price !== undefined && draft.price > 0 ? roundPrice(draft.price) : null;
    }
    const limit = draft.limitPrice !== undefined && draft.limitPrice > 0 ? roundPrice(draft.limitPrice) : null;
    if (limit === null)
        return null;
    if (last === null)
        return limit;
    return draft.side === 'buy' ? Math.min(limit, last) : Math.max(limit, last);
}
/**
 * Pre-trade checks. Everything the MVP promises is checked here before an
 * order can enter the ledger; failures are returned, never thrown.
 */
export function checkOrder(state, draft, quote, settings, tradeDate) {
    if (state.blocked)
        return { ok: false, code: 'ACCOUNT_BLOCKED', message: '账户已因对账失败锁定，请检查后重置' };
    const symbol = draft.symbol?.trim();
    if (!symbol)
        return { ok: false, code: 'INVALID_SYMBOL', message: '缺少证券代码' };
    if (!Number.isInteger(draft.qty) || draft.qty <= 0) {
        return { ok: false, code: 'INVALID_QTY', message: '数量必须是正整数' };
    }
    if (draft.type === 'limit' && !(draft.limitPrice !== undefined && draft.limitPrice > 0)) {
        return { ok: false, code: 'INVALID_ARGUMENT', message: '限价单必须给出正的限价' };
    }
    if (draft.type === 'market' && draft.price !== undefined && !(draft.price > 0)) {
        return { ok: false, code: 'INVALID_ARGUMENT', message: '价格必须为正' };
    }
    if (draft.side === 'buy' && draft.qty % 100 !== 0) {
        return { ok: false, code: 'INVALID_LOT', message: '买入数量必须是 100 股的整数倍' };
    }
    const price = estimatePrice(draft, quote);
    if (price === null)
        return { ok: false, code: 'QUOTE_UNAVAILABLE', message: '没有可用行情，请刷新或填写价格' };
    if (quote?.status === 'suspended')
        return { ok: false, code: 'SUSPENDED', message: '标的当前停牌' };
    const limit = priceLimitFor(symbol, quote?.name, quote?.prevClose);
    if (limit !== undefined) {
        const checked = draft.type === 'limit' ? (draft.limitPrice ?? price) : price;
        if (!isWithinLimit(checked, limit)) {
            return { ok: false, code: 'PRICE_LIMIT', message: `价格超出涨跌停范围（${limit.lower.toFixed(2)}–${limit.upper.toFixed(2)}）` };
        }
    }
    const amount = amountCents(price, draft.qty);
    if (draft.side === 'buy') {
        const fees = computeFees(amount, 'buy', settings);
        if (state.cashCents < amount + fees.totalCents) {
            return { ok: false, code: 'INSUFFICIENT_CASH', message: '可用资金不足（含费用）' };
        }
        if (settings.maxOrderNotionalCents > 0 && amount > settings.maxOrderNotionalCents) {
            return { ok: false, code: 'MAX_NOTIONAL', message: '超过单笔金额上限' };
        }
    }
    else {
        const position = state.positions[symbol];
        const available = position?.available ?? 0;
        // A pre-open / after-close order belongs to a later trade date, when the
        // T+1 lock has already been released; only the total holding must cover it.
        const future = tradeDate !== undefined && tradeDate > state.tradeDate;
        // 09:15–09:30: the trade date has switched but T+1 unlocks at 09:30.
        const unlockPending = tradeDate !== undefined && tradeDate === state.tradeDate && state.lastOpenedDate !== state.tradeDate;
        const sellable = future || unlockPending ? (position?.qty ?? 0) : available;
        if (sellable < draft.qty) {
            return {
                ok: false,
                code: position === undefined ? 'INSUFFICIENT_POSITION' : 'T1_LOCKED',
                message: position === undefined ? '没有该持仓' : `可卖数量不足（可卖 ${sellable} 股）`,
            };
        }
    }
    return { ok: true, price, amountCents: amount };
}
//# sourceMappingURL=risk.js.map