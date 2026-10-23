import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayTradeDate, tradeDateOf } from '../core/calendar.js';
import { resolveDshHome } from '../store/paths.js';
const CONTRACTS_TOOL = 'ft_v1_futures_futures_base_data';
const MINUTES_TOOL = 'ft_v4_futures_minutes_realtime';
const LIMIT_TOOL = 'ft_v1_futures_ft_limit';
const SETTLE_TOOL = 'ft_v1_futures_fut_settle';
const KLINE_TOOL = 'ft_v1_futures_kline';
/** The index returns 4 pages of 500 rows (2 rows per contract). */
const CONTRACTS_PAGE_SIZE = 500;
const CONTRACTS_MAX_PAGES = 4;
/** Every futures realtime interface accepts at most 20 symbols per call. */
const SYMBOL_BATCH = 20;
/** Limit/settlement tables are fetched whole-exchange, 500 rows per page. */
const TABLE_PAGE_SIZE = 500;
const TABLE_MAX_PAGES = 8;
/**
 * Three suffix sets are in play (spec §4.2). The market-data / CTP set is the
 * only one this module exposes; the other two stay local to the request layer.
 */
const SUFFIX_TO_EXCHANGE = {
    SHFE: 'SHFE',
    SHF: 'SHFE',
    INE: 'INE',
    DCE: 'DCE',
    CZCE: 'CZCE',
    CZC: 'CZCE',
    ZCE: 'CZCE',
    CFFEX: 'CFFEX',
    CFE: 'CFFEX',
    CFX: 'CFFEX',
    GFEX: 'GFEX',
    GFE: 'GFEX',
};
/** Base-data and limit/settlement suffix for each exchange. */
const EXCHANGE_TABLE_SUFFIX = {
    SHFE: 'SHF',
    INE: 'INE',
    DCE: 'DCE',
    CZCE: 'ZCE',
    CFFEX: 'CFX',
    GFEX: 'GFE',
};
const INDEXED_EXCHANGES = new Set([
    'SHFE',
    'INE',
    'DCE',
    'CZCE',
    'GFEX',
]);
function isIndexedExchange(exchange) {
    return exchange !== undefined && INDEXED_EXCHANGES.has(exchange);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
        const text = value.replace(/,/g, '').trim();
        if (text === '')
            return undefined;
        const parsed = Number(text);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function pickPositive(row, keys) {
    for (const key of keys) {
        const value = asNumber(row[key]);
        if (value !== undefined && value > 0)
            return value;
    }
    return undefined;
}
function pickNonNegative(row, keys) {
    for (const key of keys) {
        const value = asNumber(row[key]);
        if (value !== undefined && value >= 0)
            return value;
    }
    return undefined;
}
function pickString(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
    }
    return undefined;
}
function firstNumberInText(text) {
    const match = /-?\d+(?:\.\d+)?/.exec(text);
    if (match === null)
        return undefined;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
}
/** `20261022` / `"2026-10-22"` / `"2026-10-22 00:00:00"` -> `2026-10-22`. */
function isoDateOf(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return isoDateOf(String(Math.trunc(value)));
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    const eight = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (eight !== null)
        return `${eight[1]}-${eight[2]}-${eight[3]}`;
    const dashed = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (dashed !== null)
        return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
    return undefined;
}
function epochMillis(value) {
    if (value >= 1e12)
        return value;
    if (value >= 1e9)
        return value * 1000;
    return undefined;
}
/** Minutes/limits return epoch millis, `YYYY-MM-DD HH:mm:ss` CST or ISO text. */
function toIsoTimestamp(value) {
    if (typeof value === 'number') {
        const millis = epochMillis(value);
        return millis === undefined ? undefined : new Date(millis).toISOString();
    }
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    if (text === '')
        return undefined;
    if (/^\d+$/.test(text)) {
        const millis = epochMillis(Number(text));
        return millis === undefined ? undefined : new Date(millis).toISOString();
    }
    const normalized = text.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
        const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+08:00`;
        const parsed = Date.parse(zoned);
        return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
function barTimeMs(row) {
    for (const key of ['timestamp', 'ts_millis', 'ts', 'datetime', 'time', 'updated_at']) {
        const iso = toIsoTimestamp(row[key]);
        if (iso !== undefined)
            return Date.parse(iso);
    }
    return undefined;
}
function splitSymbol(raw) {
    const text = raw.trim().toUpperCase();
    const dot = text.lastIndexOf('.');
    if (dot <= 0 || dot === text.length - 1)
        return { code: text };
    return { code: text.slice(0, dot), suffix: text.slice(dot + 1) };
}
/** Accept all three suffix sets; always hand back the market-data (CTP) one. */
function normalizeToMarket(raw) {
    const { code, suffix } = splitSymbol(raw);
    if (code === '')
        return '';
    const exchange = suffix === undefined ? undefined : SUFFIX_TO_EXCHANGE[suffix];
    if (exchange === undefined)
        return code === '' ? '' : raw.trim().toUpperCase();
    return `${code}.${exchange}`;
}
function exchangeOfSymbol(raw) {
    const { suffix } = splitSymbol(raw);
    return suffix === undefined ? undefined : SUFFIX_TO_EXCHANGE[suffix];
}
function exchangeOfValue(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim().toUpperCase();
    return text === '' ? undefined : SUFFIX_TO_EXCHANGE[text];
}
function uniqueSymbols(symbols) {
    const seen = new Set();
    const out = [];
    for (const symbol of symbols) {
        const normalized = normalizeToMarket(symbol);
        if (normalized === '' || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
function chunks(items, size) {
    const out = [];
    for (let index = 0; index < items.length; index += size)
        out.push(items.slice(index, index + size));
    return out;
}
function ratioOf(row, keys) {
    const raw = pickPositive(row, keys);
    if (raw === undefined)
        return undefined;
    // `m_ratio` is published as a percentage (10), margin_info as `10%` or `0.1`.
    return raw > 1 ? raw / 100 : raw;
}
function parseMarginRate(row) {
    const direct = pickPositive(row, ['margin_rate', 'margin_ratio', 'marginRate']);
    if (direct !== undefined)
        return direct > 1 ? direct / 100 : direct;
    const text = pickString(row, ['margin_info', 'margin_text']);
    if (text === undefined)
        return undefined;
    const value = firstNumberInText(text);
    if (value === undefined || value <= 0)
        return undefined;
    if (text.includes('%'))
        return value / 100;
    return value > 1 ? value / 100 : value;
}
function parseTickSize(row) {
    const direct = pickPositive(row, ['min_put_price', 'tick_size', 'price_tick']);
    if (direct !== undefined)
        return direct;
    const text = pickString(row, ['min_put_price_info', 'min_tick_info']);
    if (text === undefined)
        return undefined;
    const value = firstNumberInText(text);
    return value !== undefined && value > 0 ? value : undefined;
}
function lastMinuteRow(rows) {
    if (rows === undefined || rows.length === 0)
        return undefined;
    const ordered = [...rows];
    ordered.sort((a, b) => (barTimeMs(a) ?? 0) - (barTimeMs(b) ?? 0));
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        if (pickPositive(ordered[index], ['close', 'last', 'latest', 'price']) !== undefined)
            return ordered[index];
    }
    return ordered[ordered.length - 1];
}
/** Expand `{ symbol, items: [...] }` groups into flat rows. */
function flattenRows(rows) {
    const out = [];
    const visit = (value, parent) => {
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item, parent);
            return;
        }
        if (typeof value !== 'object' || value === null)
            return;
        const row = value;
        const merged = parent === undefined ? row : { ...parent, ...row };
        const items = row.items;
        if (Array.isArray(items)) {
            for (const item of items)
                visit(item, merged);
            return;
        }
        out.push(merged);
    };
    visit(rows);
    return out;
}
function missingNotice(missing, what) {
    if (missing.length === 0)
        return undefined;
    if (missing.length > 4)
        return `缺少 ${missing.length} 个合约的${what}`;
    return `没有 ${missing.join('、')} 的${what}`;
}
function joinNotices(notices) {
    const nonEmpty = notices.filter(notice => notice.trim() !== '');
    return nonEmpty.length === 0 ? undefined : nonEmpty.join('；');
}
function cachedContract(value) {
    if (!isRecord(value))
        return undefined;
    const symbol = typeof value.symbol === 'string' ? value.symbol.trim().toUpperCase() : '';
    const exchange = exchangeOfValue(value.exchange) ?? exchangeOfSymbol(symbol);
    if (symbol === '' || !isIndexedExchange(exchange))
        return undefined;
    const multiplier = asNumber(value.multiplier);
    const tickSize = asNumber(value.tickSize);
    if (multiplier === undefined || multiplier <= 0 || tickSize === undefined || tickSize <= 0)
        return undefined;
    return {
        symbol: normalizeToMarket(symbol),
        name: typeof value.name === 'string' ? value.name : undefined,
        product: typeof value.product === 'string' && value.product !== ''
            ? value.product
            : (/^[A-Za-z]+/.exec(splitSymbol(symbol).code)?.[0] ?? '').toLowerCase(),
        exchange,
        multiplier,
        tickSize,
        marginRate: asNumber(value.marginRate),
        tradeHours: typeof value.tradeHours === 'string' ? value.tradeHours : undefined,
        deListDate: isoDateOf(value.deListDate),
    };
}
/**
 * FTShare adapter for the futures market-data port.
 *
 * The contract index is cached per trade date in memory and at
 * `$DSH_HOME/paper-trading/futures/contracts.json`, so a restarted panel does
 * not spend its four monthly calls on every open. Every method degrades to
 * `denied` / `failed` with a readable notice instead of throwing.
 */
export class FtshareFuturesMarketData {
    service;
    cache;
    /** Exchange tables are daily snapshots; one fetch per exchange per trade date. */
    tableCache = new Map();
    constructor(service) {
        this.service = service;
    }
    async contracts(refresh = false) {
        const tradeDate = todayTradeDate();
        if (!refresh) {
            if (this.cache?.tradeDate === tradeDate)
                return { state: 'ok', value: this.cache.contracts };
            const file = this.readCacheFile();
            if (file?.tradeDate === tradeDate) {
                this.cache = file;
                return { state: 'ok', value: file.contracts };
            }
        }
        const previous = this.cache ?? this.readCacheFile();
        const fetched = await this.fetchContracts();
        if (fetched.state !== 'ok') {
            return this.contractsFallback(fetched.state, fetched.notice ?? '合约索引不可用', previous);
        }
        if (fetched.rows.length === 0) {
            return { state: 'ok', value: [], notice: '上游合约索引为空' };
        }
        const contracts = this.toContracts(fetched.rows);
        if (contracts.length === 0) {
            return { state: 'ok', value: [], notice: '合约索引没有可交易合约' };
        }
        this.cache = { tradeDate, contracts };
        this.writeCacheFile({ tradeDate, savedAt: new Date().toISOString(), contracts });
        return { state: 'ok', value: contracts };
    }
    async quotes(symbols) {
        const unique = uniqueSymbols(symbols);
        if (unique.length === 0)
            return { state: 'ok', value: [] };
        const minutes = await this.fetchMinuteRows(unique);
        if (minutes.state !== 'ok')
            return { state: minutes.state, notice: minutes.notice };
        const value = [];
        const missing = [];
        for (const symbol of unique) {
            const rows = minutes.rows.get(symbol);
            const quote = this.quoteFromRows(symbol, rows);
            if (quote === undefined)
                missing.push(symbol);
            else
                value.push(quote);
        }
        return { state: 'ok', value, notice: missingNotice(missing, '分钟行情') };
    }
    async limits(symbols) {
        const unique = uniqueSymbols(symbols);
        if (unique.length === 0)
            return { state: 'ok', value: [] };
        const byExchange = new Map();
        const fallback = [];
        for (const symbol of unique) {
            const exchange = exchangeOfSymbol(symbol);
            if (exchange === undefined) {
                fallback.push(symbol);
                continue;
            }
            const group = byExchange.get(exchange) ?? [];
            group.push(symbol);
            byExchange.set(exchange, group);
        }
        const resolved = new Map();
        const notices = [];
        for (const [exchange, group] of byExchange) {
            const table = await this.fetchExchangeTable(LIMIT_TOOL, exchange);
            if (table.state !== 'ok') {
                notices.push(`${exchange} 涨跌停不可用：${table.notice ?? '接口调用失败'}`);
                fallback.push(...group);
                continue;
            }
            const rows = new Map();
            for (const row of table.rows) {
                const raw = pickString(row, ['ts_code', 'symbol', 'contract']);
                if (raw !== undefined)
                    rows.set(normalizeToMarket(raw), row);
            }
            for (const symbol of group) {
                const row = rows.get(symbol);
                const upper = row === undefined ? undefined : pickPositive(row, ['up_limit', 'upper', 'upper_limit']);
                const lower = row === undefined ? undefined : pickPositive(row, ['down_limit', 'lower', 'lower_limit']);
                if (row === undefined || upper === undefined || lower === undefined) {
                    fallback.push(symbol);
                    continue;
                }
                resolved.set(symbol, {
                    symbol,
                    upper,
                    lower,
                    marginRate: ratioOf(row, ['m_ratio', 'margin_ratio', 'margin_rate', 'ratio']),
                    source: 'limit',
                });
            }
        }
        const fallbackSymbols = uniqueSymbols(fallback);
        const missing = [];
        if (fallbackSymbols.length > 0) {
            const minutes = await this.fetchMinuteRows(fallbackSymbols);
            if (minutes.state !== 'ok')
                return { state: minutes.state, notice: minutes.notice };
            for (const symbol of fallbackSymbols) {
                const row = lastMinuteRow(minutes.rows.get(symbol));
                const upper = row === undefined ? undefined : pickPositive(row, ['high_limit_price', 'up_limit', 'upper_limit']);
                const lower = row === undefined ? undefined : pickPositive(row, ['low_limit_price', 'down_limit', 'lower_limit']);
                if (row === undefined || upper === undefined || lower === undefined) {
                    missing.push(symbol);
                    continue;
                }
                resolved.set(symbol, {
                    symbol,
                    upper,
                    lower,
                    marginRate: ratioOf(row, ['m_ratio', 'margin_ratio', 'margin_rate', 'ratio']),
                    source: 'minutes',
                });
            }
        }
        const value = [];
        for (const symbol of unique) {
            const limit = resolved.get(symbol);
            if (limit !== undefined)
                value.push(limit);
        }
        const notice = joinNotices([...notices, missingNotice(missing, '涨跌停') ?? '']);
        return { state: 'ok', value, notice };
    }
    async settle(symbols) {
        const unique = uniqueSymbols(symbols);
        if (unique.length === 0)
            return { state: 'ok', value: [] };
        const byExchange = new Map();
        const unknown = [];
        for (const symbol of unique) {
            const exchange = exchangeOfSymbol(symbol);
            if (exchange === undefined) {
                unknown.push(symbol);
                continue;
            }
            const group = byExchange.get(exchange) ?? [];
            group.push(symbol);
            byExchange.set(exchange, group);
        }
        const value = new Map();
        const missing = [...unknown];
        for (const [exchange, group] of byExchange) {
            const table = await this.fetchExchangeTable(SETTLE_TOOL, exchange);
            if (table.state !== 'ok')
                return { state: table.state, notice: table.notice ?? '结算参数不可用' };
            const rows = new Map();
            for (const row of table.rows) {
                const raw = pickString(row, ['ts_code', 'symbol', 'contract']);
                if (raw !== undefined)
                    rows.set(normalizeToMarket(raw), row);
            }
            for (const symbol of group) {
                const row = rows.get(symbol);
                if (row === undefined) {
                    missing.push(symbol);
                    continue;
                }
                const settle = pickPositive(row, ['settle', 'settlement_price', 'settlement']);
                const longMarginRate = ratioOf(row, ['long_margin_rate', 'long_margin_ratio']);
                const tradingFee = pickNonNegative(row, ['trading_fee', 'fee']);
                const closeTodayFee = pickNonNegative(row, ['offset_today_fee', 'close_today_fee']);
                if (settle === undefined && longMarginRate === undefined
                    && tradingFee === undefined && closeTodayFee === undefined) {
                    missing.push(symbol);
                    continue;
                }
                value.set(symbol, {
                    symbol,
                    settle,
                    longMarginRate,
                    feePerLotCents: tradingFee === undefined ? undefined : Math.round(tradingFee * 100),
                    closeTodayFeePerLotCents: closeTodayFee === undefined ? undefined : Math.round(closeTodayFee * 100),
                });
            }
        }
        const list = [];
        for (const symbol of unique) {
            const settle = value.get(symbol);
            if (settle !== undefined)
                list.push(settle);
        }
        return { state: 'ok', value: list, notice: missingNotice(missing, '结算参数') };
    }
    async closes(symbols, date) {
        const unique = uniqueSymbols(symbols);
        if (unique.length === 0)
            return { state: 'ok', value: [] };
        const targetDate = date === undefined ? undefined : isoDateOf(date) ?? date;
        const value = new Map();
        const fallback = [];
        const notices = [];
        for (const symbol of unique) {
            const kline = await this.call(KLINE_TOOL, this.klineArgs(symbol, targetDate));
            if (kline.state !== 'ok') {
                notices.push(`${symbol} 日 K 不可用：${kline.notice ?? '接口调用失败'}`);
                fallback.push(symbol);
                continue;
            }
            const row = this.pickDailyClose(kline.rows, targetDate);
            const close = row === undefined ? undefined : pickPositive(row, ['close', '收盘', 'close_price']);
            if (row === undefined || close === undefined) {
                fallback.push(symbol);
                continue;
            }
            value.set(symbol, {
                symbol,
                close,
                tradeDate: isoDateOf(row.trade_date ?? row.date ?? row.datetime ?? row.time)
                    ?? targetDate
                    ?? todayTradeDate(),
                source: 'daily',
            });
        }
        const missing = [];
        if (fallback.length > 0) {
            const minutes = await this.fetchMinuteRows(fallback);
            if (minutes.state !== 'ok')
                return { state: minutes.state, notice: minutes.notice };
            for (const symbol of fallback) {
                const row = lastMinuteRow(minutes.rows.get(symbol));
                const close = row === undefined ? undefined : pickPositive(row, ['close', 'last', 'latest', 'price']);
                if (row === undefined || close === undefined) {
                    missing.push(symbol);
                    continue;
                }
                value.set(symbol, {
                    symbol,
                    close,
                    tradeDate: isoDateOf(row.trade_date) ?? tradeDateOf(new Date().toISOString()),
                    source: 'minutes',
                });
            }
        }
        const list = [];
        for (const symbol of unique) {
            const close = value.get(symbol);
            if (close !== undefined)
                list.push(close);
        }
        const notice = joinNotices([...notices, missingNotice(missing, '收盘价') ?? '']);
        return { state: 'ok', value: list, notice };
    }
    contractsFallback(state, notice, previous) {
        if (previous !== undefined) {
            this.cache = previous;
            return {
                state: 'stale',
                value: previous.contracts,
                notice: `合约索引刷新失败，沿用 ${previous.tradeDate} 缓存：${notice}`,
            };
        }
        return { state, notice };
    }
    async fetchContracts() {
        const rows = [];
        for (let page = 1; page <= CONTRACTS_MAX_PAGES; page += 1) {
            const outcome = await this.call(CONTRACTS_TOOL, { page, page_size: CONTRACTS_PAGE_SIZE });
            if (outcome.state !== 'ok')
                return { state: outcome.state, rows: [], notice: outcome.notice };
            rows.push(...outcome.rows);
            if (outcome.rows.length < CONTRACTS_PAGE_SIZE)
                break;
        }
        return { state: 'ok', rows };
    }
    toContracts(rows) {
        const merged = new Map();
        for (const row of rows) {
            const raw = pickString(row, ['symbol', 'ts_code', 'contract']);
            if (raw === undefined)
                continue;
            // NIB has no market-data interface; CFFEX is out of the MVP scope.
            const declared = pickString(row, ['exchange'])?.toUpperCase();
            if (declared === 'NIB' || declared === 'CFFEX')
                continue;
            const { code, suffix } = splitSymbol(raw);
            if (code === '')
                continue;
            const exchange = exchangeOfValue(row.exchange) ?? (suffix === undefined ? undefined : SUFFIX_TO_EXCHANGE[suffix]);
            if (!isIndexedExchange(exchange))
                continue;
            const key = `${code}.${exchange}`;
            const existing = merged.get(key);
            if (existing === undefined) {
                merged.set(key, { ...row });
                continue;
            }
            for (const [field, value] of Object.entries(row)) {
                if (existing[field] === undefined || existing[field] === null || existing[field] === '')
                    existing[field] = value;
            }
        }
        const contracts = [];
        for (const [symbol, row] of merged) {
            const multiplier = pickPositive(row, ['multiplier', 'contract_multiplier', 'trade_unit']);
            const tickSize = parseTickSize(row);
            if (multiplier === undefined || tickSize === undefined)
                continue;
            const exchange = exchangeOfSymbol(symbol);
            if (!isIndexedExchange(exchange))
                continue;
            const { code } = splitSymbol(symbol);
            contracts.push({
                symbol,
                name: pickString(row, ['symbol_cn_name', 'name', 'contract_name']),
                product: (pickString(row, ['product', 'variety', 'product_code']) ?? /^[A-Za-z]+/.exec(code)?.[0] ?? '').toLowerCase(),
                exchange,
                multiplier,
                tickSize,
                marginRate: parseMarginRate(row),
                tradeHours: pickString(row, ['trade_hours_info', 'trade_hours', 'trade_time']),
                deListDate: isoDateOf(row.de_list_tdate ?? row.de_list_date ?? row.last_trade_date),
            });
        }
        contracts.sort((a, b) => a.symbol.localeCompare(b.symbol));
        return contracts;
    }
    async fetchMinuteRows(symbols) {
        const rows = new Map();
        for (const batch of chunks(symbols, SYMBOL_BATCH)) {
            const outcome = await this.call(MINUTES_TOOL, { symbols: batch });
            if (outcome.state !== 'ok')
                return { state: outcome.state, rows: new Map(), notice: outcome.notice };
            const grouped = this.groupMinuteRows(outcome.rows);
            for (const symbol of batch) {
                const group = grouped.get(symbol);
                if (group !== undefined)
                    rows.set(symbol, group);
            }
        }
        return { state: 'ok', rows };
    }
    groupMinuteRows(rows) {
        const grouped = new Map();
        for (const row of rows) {
            const raw = pickString(row, ['symbol', 'ts_code', 'contract']);
            if (raw === undefined)
                continue;
            const symbol = normalizeToMarket(raw);
            if (symbol === '')
                continue;
            const group = grouped.get(symbol) ?? [];
            group.push(row);
            grouped.set(symbol, group);
        }
        return grouped;
    }
    quoteFromRows(symbol, rows) {
        const row = lastMinuteRow(rows);
        if (row === undefined)
            return undefined;
        const last = pickPositive(row, ['close', 'last', 'latest', 'price', '收盘']);
        if (last === undefined)
            return undefined;
        const marketTime = toIsoTimestamp(row.timestamp ?? row.ts_millis ?? row.ts ?? row.datetime)
            ?? toIsoTimestamp(row.updated_at);
        const tradeDate = isoDateOf(row.trade_date)
            ?? (marketTime === undefined ? undefined : tradeDateOf(marketTime));
        return {
            symbol,
            last,
            preSettlement: pickPositive(row, [
                'pre_settlement_price', 'presettlement_price', 'pre_settle_price', 'pre_settlement', 'presettle',
            ]),
            openInterest: pickNonNegative(row, ['open_interest', 'openinterest', 'oi', '持仓量']),
            marketTs: marketTime,
            tradeDate,
        };
    }
    async fetchExchangeTable(tool, exchange) {
        const today = todayTradeDate();
        const cacheKey = `${tool}:${exchange}:${today}`;
        const cached = this.tableCache.get(cacheKey);
        if (cached !== undefined)
            return { state: 'ok', rows: cached };
        const tradeDate = Number(today.replaceAll('-', ''));
        const rows = [];
        for (let page = 1; page <= TABLE_MAX_PAGES; page += 1) {
            const outcome = await this.call(tool, {
                exchange: EXCHANGE_TABLE_SUFFIX[exchange],
                trade_date: tradeDate,
                page,
                page_size: TABLE_PAGE_SIZE,
            });
            if (outcome.state !== 'ok')
                return { state: outcome.state, rows: [], notice: outcome.notice };
            rows.push(...outcome.rows);
            if (outcome.rows.length < TABLE_PAGE_SIZE)
                break;
        }
        this.tableCache.set(cacheKey, rows);
        return { state: 'ok', rows };
    }
    klineArgs(symbol, date) {
        const args = { symbol, interval: 'daily', limit: date === undefined ? 3 : 20 };
        if (date !== undefined) {
            const start = Date.parse(`${date}T00:00:00+08:00`);
            if (!Number.isNaN(start)) {
                args.start = start;
                args.end = start + 86_400_000 - 1;
            }
        }
        return args;
    }
    pickDailyClose(rows, date) {
        let match;
        for (const row of rows) {
            if (pickPositive(row, ['close', '收盘', 'close_price']) === undefined)
                continue;
            if (date !== undefined) {
                const tradeDate = isoDateOf(row.trade_date ?? row.date ?? row.datetime ?? row.time);
                if (tradeDate === date)
                    match = row;
                continue;
            }
            match = row;
        }
        return match;
    }
    async call(tool, args) {
        try {
            const result = await this.service.call(tool, args);
            if (result.state === 'denied') {
                return { state: 'denied', rows: [], notice: result.notice?.message ?? '接口无权限' };
            }
            if (result.state === 'failed') {
                return { state: 'failed', rows: [], notice: result.notice?.message ?? '接口调用失败' };
            }
            return { state: 'ok', rows: flattenRows(result.rows ?? []) };
        }
        catch (error) {
            return { state: 'failed', rows: [], notice: error instanceof Error ? error.message : String(error) };
        }
    }
    readCacheFile() {
        try {
            const parsed = JSON.parse(readFileSync(this.cachePath(), 'utf8'));
            if (!isRecord(parsed) || typeof parsed.tradeDate !== 'string' || !Array.isArray(parsed.contracts)) {
                return undefined;
            }
            const contracts = [];
            for (const value of parsed.contracts) {
                const contract = cachedContract(value);
                if (contract !== undefined)
                    contracts.push(contract);
            }
            if (contracts.length === 0)
                return undefined;
            return { tradeDate: parsed.tradeDate, contracts };
        }
        catch {
            // A missing or corrupt cache is a cold start, not an error.
            return undefined;
        }
    }
    writeCacheFile(file) {
        try {
            const path = this.cachePath();
            mkdirSync(join(resolveDshHome(), 'paper-trading', 'futures'), { recursive: true });
            writeFileSync(path, JSON.stringify(file), 'utf8');
        }
        catch {
            // The cache is best effort; failing to persist it must not fail the call.
        }
    }
    cachePath() {
        return join(resolveDshHome(), 'paper-trading', 'futures', 'contracts.json');
    }
}
//# sourceMappingURL=futures-market-data.js.map