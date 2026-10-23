import { PaperError } from './errors.js';
function record(value) {
    if (typeof value !== 'object' || value === null)
        throw new PaperError('INVALID_ARGUMENT', '请求参数必须是对象');
    return value;
}
function text(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new PaperError('INVALID_ARGUMENT', `缺少 ${field}`);
    return value.trim();
}
function num(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new PaperError('INVALID_ARGUMENT', `${field} 必须是数字`);
    return value;
}
function draft(value) {
    const input = record(value);
    const side = text(input.side, 'side');
    const type = text(input.type, 'type');
    if (side !== 'buy' && side !== 'sell')
        throw new PaperError('INVALID_ARGUMENT', 'side 必须是 buy 或 sell');
    if (type !== 'market' && type !== 'limit')
        throw new PaperError('INVALID_ARGUMENT', 'type 必须是 market 或 limit');
    return {
        symbol: text(input.symbol, 'symbol'),
        side: side,
        type,
        qty: num(input.qty, 'qty'),
        limitPrice: typeof input.limitPrice === 'number' ? input.limitPrice : undefined,
        price: typeof input.price === 'number' ? input.price : undefined,
    };
}
/** 32 KiB: a 20-row CSV stays tiny, but a pasted file must not slip the body cap. */
const BASKET_CSV_MAX_BYTES = 32 * 1024;
const BASKET_MAX_ROWS = 20;
const BASKET_BATCH_ID_MAX = 100;
function basketCsv(value) {
    const csv = text(value, 'csv');
    if (new TextEncoder().encode(csv).length > BASKET_CSV_MAX_BYTES) {
        throw new PaperError('INVALID_ARGUMENT', 'csv 不能超过 32 KiB');
    }
    return csv;
}
function basketBudget(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new PaperError('INVALID_ARGUMENT', 'budgetCents 必须是正整数（分）');
    }
    return value;
}
function basketRows(value) {
    if (!Array.isArray(value))
        throw new PaperError('INVALID_ARGUMENT', 'rows 必须是数组');
    if (value.length < 1 || value.length > BASKET_MAX_ROWS) {
        throw new PaperError('INVALID_ARGUMENT', `rows 需要 1 到 ${BASKET_MAX_ROWS} 行`);
    }
    return value.map(item => {
        const input = record(item);
        return { symbol: text(input.symbol, 'symbol'), qty: num(input.qty, 'qty') };
    });
}
function basketBatchId(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string')
        throw new PaperError('INVALID_ARGUMENT', 'batchId 必须是字符串');
    const id = value.trim();
    if (id === '')
        return undefined;
    if (id.length > BASKET_BATCH_ID_MAX)
        throw new PaperError('INVALID_ARGUMENT', `batchId 不能超过 ${BASKET_BATCH_ID_MAX} 字符`);
    return id;
}
function period(value) {
    if (value === '7d' || value === '30d' || value === 'all')
        return value;
    return '30d';
}
export function createPaperRpcHandler(service) {
    return async (endpoint, payload, signal) => {
        try {
            if (signal.aborted)
                throw new PaperError('INVALID_ARGUMENT', '请求已取消', 499);
            switch (endpoint) {
                case 'health':
                    return ok({ ok: true, version: 1 });
                case 'account/get':
                case 'account/init':
                    return ok(await service.account());
                case 'account/reset': {
                    const input = record(payload ?? {});
                    return ok(await service.reset(input.confirm === true));
                }
                case 'account/export':
                    return ok(await service.exportLedger());
                case 'settings/get':
                    return ok(await service.settingsView());
                case 'market/quote': {
                    const input = record(payload);
                    const symbols = Array.isArray(input.symbols) ? input.symbols.filter((item) => typeof item === 'string') : [];
                    if (symbols.length === 0)
                        throw new PaperError('INVALID_ARGUMENT', 'symbols 不能为空');
                    return ok(await service.quote(symbols));
                }
                case 'market/bars': {
                    const input = record(payload);
                    const symbol = text(input.symbol, 'symbol');
                    const limit = typeof input.limit === 'number' ? input.limit : 60;
                    if (input.interval === 'minute') {
                        return ok(await service.minuteBars(symbol, typeof input.date === 'string' ? input.date : undefined));
                    }
                    return ok(await service.dailyBars(symbol, limit));
                }
                case 'market/status':
                    return ok(await service.marketStatus());
                case 'market/search': {
                    const input = record(payload);
                    return ok(await service.search(text(input.query, 'query'), typeof input.limit === 'number' ? input.limit : 10));
                }
                case 'market/list': {
                    const input = record(payload ?? {});
                    return ok(await service.marketList({
                        board: typeof input.board === 'string' ? input.board : undefined,
                        page: typeof input.page === 'number' ? input.page : undefined,
                        pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
                    }));
                }
                case 'review/daily': {
                    const input = record(payload ?? {});
                    return ok(await service.dailyReport(typeof input.date === 'string' ? input.date : undefined));
                }
                case 'review/roundtrips':
                    return ok(await service.roundtrips());
                case 'cash/flow':
                    return ok(await service.cashFlow());
                case 'watchlist/get':
                    return ok({ symbols: await service.watchlist() });
                case 'watchlist/set': {
                    const input = record(payload ?? {});
                    const symbols = Array.isArray(input.symbols)
                        ? input.symbols.filter((item) => typeof item === 'string')
                        : [];
                    return ok({ symbols: await service.setWatchlist(symbols) });
                }
                case 'basket/preview': {
                    const input = record(payload);
                    return ok(await service.basketPreview(basketCsv(input.csv), basketBudget(input.budgetCents)));
                }
                case 'basket/place': {
                    const input = record(payload);
                    return ok(await service.basketPlace(basketRows(input.rows), basketBatchId(input.batchId)));
                }
                case 'order/preview':
                    return ok(await service.preview(draft(payload)));
                case 'order/place': {
                    const input = record(payload);
                    const orderDraft = draft(input.draft ?? input);
                    const requestId = typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : undefined;
                    return ok(await service.place(orderDraft, requestId));
                }
                case 'order/cancel': {
                    const input = record(payload);
                    return ok(await service.cancel(text(input.orderId, 'orderId')));
                }
                case 'tick':
                    return ok(await service.tick());
                case 'list/orders':
                    return ok(await service.orders());
                case 'list/trades':
                    return ok(await service.trades());
                case 'review/get': {
                    const input = record(payload ?? {});
                    return ok(await service.review(period(input.period)));
                }
                default:
                    throw new PaperError('INVALID_ARGUMENT', `未知 endpoint: ${endpoint}`, 404);
            }
        }
        catch (error) {
            if (error instanceof PaperError) {
                return { ok: false, error: { code: error.code, message: error.message } };
            }
            return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } };
        }
    };
}
function ok(value) {
    return { ok: true, value };
}
//# sourceMappingURL=rpc.js.map