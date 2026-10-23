/**
 * Security identity.
 *
 * A six-digit code is only unique inside one exchange: `000001.SZ` is 平安银行,
 * `000001.SH` is 上证指数 and `000001.OF` is a fund. Everything that enters the
 * ledger, the market data adapter or the UI therefore uses one canonical id,
 * `<code>.<exchange>`. This module is the only place that knows the exchange
 * code ranges, so parsing, validation and display stay in agreement.
 *
 * Bare six-digit input is resolved through the *stock* namespace first
 * (`000001` → `000001.SZ`); an index or a fund always needs its suffix
 * (`000001.SH`, `510300.SH`). Only stocks are tradable.
 * @module @ft/dsh-fft-paper-trading/core/symbol
 */
const SH_MAIN = /^(600|601|603|605)\d{3}$/;
const SH_STAR = /^(688|689)\d{3}$/;
const SH_FUND = /^5\d{5}$/;
const SH_INDEX = /^000\d{3}$/;
const SH_B_SHARE = /^900\d{3}$/;
const SZ_MAIN = /^(000|001|002|003)\d{3}$/;
const SZ_CHINEXT = /^(300|301|302)\d{3}$/;
const SZ_FUND = /^(15|16|18)\d{4}$/;
const SZ_INDEX = /^399\d{3}$/;
const SZ_B_SHARE = /^200\d{3}$/;
const BJ_MAIN = /^(43|83|87|88)\d{4}$/;
const BJ_NEW = /^920\d{3}$/;
const KIND_TEXT = {
    stock: '股票',
    index: '指数',
    fund: '基金',
    other: '其他品种',
};
const BOARDS = {
    stock: 'main',
    index: undefined,
    fund: undefined,
    other: undefined,
};
function boardIn(exchange, code) {
    if (exchange === 'SH') {
        if (SH_MAIN.test(code))
            return 'main';
        if (SH_STAR.test(code))
            return 'star';
        return undefined;
    }
    if (exchange === 'SZ') {
        if (SZ_CHINEXT.test(code))
            return 'chi_next';
        if (SZ_MAIN.test(code))
            return 'main';
        return undefined;
    }
    return 'bjse';
}
/** Classify a code on one exchange; `undefined` means the range is unknown there. */
function classify(exchange, code) {
    const kind = exchange === 'SH'
        ? SH_MAIN.test(code) || SH_STAR.test(code) ? 'stock'
            : SH_FUND.test(code) ? 'fund'
                : SH_INDEX.test(code) ? 'index'
                    : SH_B_SHARE.test(code) ? 'other'
                        : undefined
        : exchange === 'SZ'
            ? SZ_MAIN.test(code) || SZ_CHINEXT.test(code) ? 'stock'
                : SZ_FUND.test(code) ? 'fund'
                    : SZ_INDEX.test(code) ? 'index'
                        : SZ_B_SHARE.test(code) ? 'other'
                            : undefined
            : BJ_MAIN.test(code) || BJ_NEW.test(code) ? 'stock'
                : undefined;
    return kind === undefined ? undefined : { code, exchange, kind, id: `${code}.${exchange}` };
}
/**
 * Exchange of a bare code.
 *
 * Stocks win over other instruments because the plugin only trades stocks and
 * the panel's default namespace is "the stock I can buy". `000001` therefore
 * means 平安银行; the SSE Composite needs `000001.SH`.
 */
function infer(code) {
    if (BJ_MAIN.test(code) || BJ_NEW.test(code))
        return classify('BJ', code);
    if (SH_MAIN.test(code) || SH_STAR.test(code))
        return classify('SH', code);
    if (SZ_CHINEXT.test(code))
        return classify('SZ', code);
    if (SZ_MAIN.test(code))
        return classify('SZ', code);
    if (SH_FUND.test(code))
        return classify('SH', code);
    if (SH_B_SHARE.test(code))
        return classify('SH', code);
    if (SZ_INDEX.test(code))
        return classify('SZ', code);
    if (SZ_FUND.test(code))
        return classify('SZ', code);
    if (SZ_B_SHARE.test(code))
        return classify('SZ', code);
    return undefined;
}
function halfWidth(value) {
    return value
        .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
        .replace(/[Ａ-Ｚ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0));
}
function problem(code, message) {
    return { ok: false, code, message };
}
/**
 * Exchange suffixes accepted on input.
 *
 * dsh_kline publishes its own convention (`600519.XSHG`, `000001.XSHE`,
 * `920001.BJSE`); the ticket and the slot hand those straight over, so they are
 * aliases for the canonical `.SH` / `.SZ` / `.BJ`, never a second identity.
 */
const EXCHANGE_ALIAS = {
    SH: 'SH',
    XSHG: 'SH',
    SZ: 'SZ',
    XSHE: 'SZ',
    BJ: 'BJ',
    BJSE: 'BJ',
};
/**
 * Parse one user/model supplied symbol.
 *
 * Accepted forms: `000001`, `000001.SZ`, `000001.XSHE`, `SZ000001` (case and
 * full-width digits are folded). Everything else is rejected instead of guessed.
 */
export function tryParseSymbol(input) {
    if (typeof input !== 'string')
        return problem('INVALID_SYMBOL', '证券代码必须是字符串');
    const text = halfWidth(input).trim().toUpperCase().replace(/\s+/g, '');
    if (text === '')
        return problem('INVALID_SYMBOL', '证券代码不能为空');
    const suffix = /^(\d{6})\.([A-Z]{2,4})$/.exec(text);
    const suffixExchange = suffix === null ? undefined : EXCHANGE_ALIAS[suffix[2]];
    if (suffix !== null && suffixExchange !== undefined) {
        const [, code] = suffix;
        const exchange = suffixExchange;
        const symbol = classify(exchange, code);
        return symbol === undefined
            ? problem('INVALID_SYMBOL', `${code} 不是${exchange === 'SH' ? '沪市' : exchange === 'SZ' ? '深市' : '北交所'}代码`)
            : { ok: true, symbol };
    }
    const prefix = /^(SH|SZ|BJ)(\d{6})$/.exec(text);
    if (prefix !== null) {
        const [, exchange, code] = prefix;
        const symbol = classify(exchange, code);
        return symbol === undefined
            ? problem('INVALID_SYMBOL', `${code} 不是${exchange === 'SH' ? '沪市' : exchange === 'SZ' ? '深市' : '北交所'}代码`)
            : { ok: true, symbol };
    }
    if (/^\d{6}$/.test(text)) {
        const symbol = infer(text);
        return symbol === undefined
            ? problem('INVALID_SYMBOL', `${text} 不是已知的证券代码`)
            : { ok: true, symbol };
    }
    return problem('INVALID_SYMBOL', `代码格式应为 600519 或 600519.SH，收到 ${input}`);
}
/** Parse and require a tradable A-share stock. */
export function requireStock(input) {
    const parsed = tryParseSymbol(input);
    if (!parsed.ok)
        return parsed;
    if (parsed.symbol.kind !== 'stock') {
        return problem('UNSUPPORTED_INSTRUMENT', `${parsed.symbol.id} 是${KIND_TEXT[parsed.symbol.kind]}，不支持交易`);
    }
    return parsed;
}
export function isTradable(symbol) {
    return symbol.kind === 'stock';
}
/** Board of a tradable stock; `main` for anything the ranges do not name. */
export function boardOf(symbol) {
    return boardIn(symbol.exchange, symbol.code) ?? BOARDS[symbol.kind] ?? 'main';
}
/** `000001.SZ 平安银行`; the name is dropped when the data source has none. */
export function formatSymbol(id, name) {
    const label = typeof name === 'string' ? name.trim() : '';
    return label === '' ? id : `${id} ${label}`;
}
//# sourceMappingURL=symbol.js.map