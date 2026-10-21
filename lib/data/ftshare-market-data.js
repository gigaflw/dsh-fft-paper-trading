/** Per-symbol realtime bars first, then the generic candlestick endpoint. */
const DEFAULT_QUOTE_TOOLS = ['ft_v4_stock_realtime_day_kline', 'ft_v1_stock_candlesticks'];
const DEFAULT_KLINE_TOOLS = ['ft_v1_stock_candlesticks', 'ft_v2_stock_candlesticks_batch'];
const INTERVAL_UNITS = ['day', 'Day'];
function normalizeSymbol(symbol) {
    const text = symbol.trim().toUpperCase();
    if (/\.(SH|SZ|BJ|XSHG|XSHE)$/.test(text))
        return text;
    if (/^\d{6}$/.test(text)) {
        if (text.startsWith('6'))
            return `${text}.SH`;
        if (text.startsWith('0') || text.startsWith('3'))
            return `${text}.SZ`;
        if (text.startsWith('8') || text.startsWith('4'))
            return `${text}.BJ`;
    }
    return text;
}
function pickNumber(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0)
            return value;
        if (typeof value === 'string') {
            const parsed = Number(value.replace(/,/g, ''));
            if (Number.isFinite(parsed) && parsed > 0)
                return parsed;
        }
    }
    return undefined;
}
function pickString(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value;
    }
    return undefined;
}
function timestampOf(row) {
    const numeric = pickNumber(row, ['ts_millis', 'timestamp', 'ts', 'time']);
    if (numeric !== undefined) {
        const millis = numeric > 1e12 ? numeric : numeric * 1000;
        return new Date(millis).toISOString();
    }
    const text = pickString(row, ['datetime', 'time', 'date', 'trade_date']);
    if (text !== undefined) {
        const parsed = Date.parse(text);
        if (!Number.isNaN(parsed))
            return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
}
/** Expand `{ symbol, items: [...] }` groups into flat rows. */
function flatten(rows) {
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
/**
 * FTShare adapter.
 *
 * The gateway exposes one interface per dataset and their parameter schemas
 * differ; the adapter pins a small preference list, normalises symbols to the
 * `.SH` / `.SZ` form the interfaces expect and flattens grouped rows.
 */
export class FtshareMarketData {
    service;
    quoteTools;
    klineTools;
    known;
    constructor(service, overrides = {}) {
        this.service = service;
        this.quoteTools = overrides.quoteTools ?? DEFAULT_QUOTE_TOOLS;
        this.klineTools = overrides.klineTools ?? DEFAULT_KLINE_TOOLS;
    }
    async available() {
        if (this.known !== undefined)
            return this.known;
        try {
            const tools = await this.service.listTools();
            this.known = new Set(tools.map(tool => tool.tool));
        }
        catch {
            this.known = undefined;
        }
        return this.known;
    }
    async call(tool, args) {
        try {
            const result = await this.service.call(tool, args);
            if (result.state === 'denied') {
                return { rows: [], state: 'denied', notice: result.notice?.message ?? '接口无权限' };
            }
            if (result.state === 'failed') {
                return { rows: [], state: 'failed', notice: result.notice?.message ?? '接口调用失败' };
            }
            return { rows: flatten(result.rows), state: 'ok' };
        }
        catch (error) {
            return { rows: [], state: 'failed', notice: String(error) };
        }
    }
    async quoteFor(symbol) {
        const apiSymbol = normalizeSymbol(symbol);
        const known = await this.available();
        const notices = [];
        for (const tool of this.quoteTools) {
            if (known !== undefined && !known.has(tool))
                continue;
            if (tool === 'ft_v1_stock_candlesticks' || tool === 'ft_v2_stock_candlesticks_batch') {
                for (const interval of INTERVAL_UNITS) {
                    const result = await this.call(tool, {
                        symbol: apiSymbol,
                        interval_unit: interval,
                        limit: 2,
                        until_ts_millis: Date.now(),
                    });
                    if (result.rows.length > 0) {
                        const quote = this.toQuote(symbol, result.rows[result.rows.length - 1], tool);
                        if (quote !== undefined)
                            return { state: 'ok', quotes: [quote] };
                    }
                    if (result.notice !== undefined)
                        notices.push(result.notice);
                }
                continue;
            }
            const result = await this.call(tool, { symbols: [apiSymbol] });
            if (result.rows.length > 0) {
                const quote = this.toQuote(symbol, result.rows[result.rows.length - 1], tool);
                if (quote !== undefined)
                    return { state: 'ok', quotes: [quote] };
            }
            if (result.notice !== undefined)
                notices.push(result.notice);
        }
        const denied = notices.some(notice => /权限|denied|route_not_allowed/i.test(notice));
        return { state: denied ? 'denied' : 'failed', quotes: [], notice: notices.join('；') || `没有 ${symbol} 的行情` };
    }
    toQuote(symbol, row, source) {
        const last = pickNumber(row, ['close', 'last', 'latest', 'price', '收盘', '最新价']);
        if (last === undefined)
            return undefined;
        const bid = pickNumber(row, ['bid', 'bid1', 'buy1', '买一价', 'bid_price']) ?? last;
        const ask = pickNumber(row, ['ask', 'ask1', 'sell1', '卖一价', 'ask_price']) ?? last;
        const prevClose = pickNumber(row, ['prev_close', 'pre_close', 'preclose', '昨收']);
        return {
            symbol,
            name: pickString(row, ['name', 'symbol_name', '名称', 'sec_name']),
            last,
            bid,
            ask,
            prevClose,
            // `ts` means "fetched at", not the bar's market time: the simulator must
            // accept the last close after hours instead of calling it stale.
            ts: new Date().toISOString(),
            source,
        };
    }
    async quotes(symbols) {
        const unique = [...new Set(symbols.map(symbol => symbol.trim()).filter(Boolean))];
        if (unique.length === 0)
            return { state: 'ok', quotes: [] };
        const quotes = [];
        const notices = [];
        let denied = false;
        for (const symbol of unique) {
            const result = await this.quoteFor(symbol);
            quotes.push(...result.quotes);
            if (result.state === 'denied')
                denied = true;
            if (result.notice !== undefined && result.quotes.length === 0)
                notices.push(result.notice);
        }
        if (quotes.length === 0) {
            return { state: denied ? 'denied' : 'failed', quotes, notice: notices.join('；') || '行情不可用' };
        }
        return { state: 'ok', quotes, notice: notices.length > 0 ? notices.join('；') : undefined };
    }
    async dailyBars(symbol, limit) {
        const known = await this.available();
        const notices = [];
        for (const tool of this.klineTools) {
            if (known !== undefined && !known.has(tool))
                continue;
            for (const interval of INTERVAL_UNITS) {
                const args = tool === 'ft_v2_stock_candlesticks_batch'
                    ? { symbols: [normalizeSymbol(symbol)], interval_unit: interval, limit, until_ts_millis: Date.now() }
                    : { symbol: normalizeSymbol(symbol), interval_unit: interval, limit, until_ts_millis: Date.now() };
                const result = await this.call(tool, args);
                if (result.rows.length > 0) {
                    const bars = result.rows.map(row => this.toBar(row)).filter((bar) => bar !== undefined);
                    if (bars.length > 0) {
                        bars.sort((a, b) => a.time.localeCompare(b.time));
                        return { state: 'ok', bars: bars.slice(-limit) };
                    }
                }
                if (result.notice !== undefined)
                    notices.push(result.notice);
            }
        }
        return { state: 'failed', bars: [], notice: notices.join('；') || `没有 ${symbol} 的日 K 数据` };
    }
    toBar(row) {
        const close = pickNumber(row, ['close', '收盘', 'close_price']);
        if (close === undefined)
            return undefined;
        return {
            time: timestampOf(row),
            open: pickNumber(row, ['open', '开盘']) ?? close,
            high: pickNumber(row, ['high', '最高']) ?? close,
            low: pickNumber(row, ['low', '最低']) ?? close,
            close,
            volume: pickNumber(row, ['volume', 'vol', '成交量']),
        };
    }
}
//# sourceMappingURL=ftshare-market-data.js.map