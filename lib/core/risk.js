import { amountCents, slipped } from './money.js';
import { computeFees } from './fees.js';
import { isWithinLimit, priceLimitFor } from './price-limit.js';
/** Estimate the fill price used by risk, preview and the submit path. */
export function estimatePrice(draft, quote, settings) {
    if (draft.type === 'limit') {
        return draft.limitPrice !== undefined && draft.limitPrice > 0 ? draft.limitPrice : null;
    }
    if (quote !== null) {
        const base = quote.last;
        if (Number.isFinite(base) && base > 0)
            return slipped(base, draft.side, settings.slippageBps);
    }
    if (draft.price !== undefined && draft.price > 0)
        return draft.price;
    return null;
}
/**
 * Pre-trade checks. Everything the MVP promises is checked here before an
 * order can enter the ledger; failures are returned, never thrown.
 */
export function checkOrder(state, draft, quote, settings) {
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
    const price = estimatePrice(draft, quote, settings);
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
        if (available < draft.qty) {
            return {
                ok: false,
                code: position === undefined ? 'INSUFFICIENT_POSITION' : 'T1_LOCKED',
                message: position === undefined ? '没有该持仓' : `可卖数量不足（可卖 ${available} 股）`,
            };
        }
    }
    return { ok: true, price, amountCents: amount };
}
//# sourceMappingURL=risk.js.map