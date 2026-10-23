import { dirname, join } from 'node:path';
import { defineJsonTool as defineTool } from './json-tools.js';
import { PaperError } from '../service/errors.js';
import { formatSymbol } from '../core/symbol.js';
import { renderAccount, renderOrder, renderPreview, renderReview } from './format.js';
const outputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        summary: { type: 'string' },
        data: { type: 'json' },
    },
};
const noParameters = {};
const parameters = {
    symbol: { type: 'string', description: '证券代码（含市场），例如 600519.SH、000001.SZ；裸 6 位按股票解析' },
    symbols: { type: 'array', items: { type: 'string' }, description: '证券代码列表（含市场），例如 [600519.SH, 000001.SZ]' },
    side: { type: 'string', description: 'buy 或 sell' },
    type: { type: 'string', description: 'market 或 limit' },
    qty: { type: 'number', description: '数量（股）' },
    limitPrice: { type: 'number', description: '限价单价格' },
    price: { type: 'number', description: '无行情时的参考价（仅市价单）' },
    orderId: { type: 'string', description: '订单 ID' },
    requestId: { type: 'string', description: '幂等请求 ID；重复调用返回同一订单' },
    period: { type: 'string', description: '复盘区间：7d、30d、all' },
    reset: { type: 'boolean', description: '是否重置账户' },
    confirm: { type: 'boolean', description: '重置时必须为 true' },
    action: { type: 'string', description: 'market 动作：status / search / list' },
    query: { type: 'string', description: '搜索关键词' },
    board: { type: 'string', description: '板块：main / star / chi_next / bjse / xshg / xshe' },
    page: { type: 'number', description: '页码，从 1 开始' },
    pageSize: { type: 'number', description: '每页条数，最大 500' },
    note: { type: 'string', description: '复盘备注，最多 120 字' },
};
function draftOf(args) {
    // Never coerce an unknown side/type to a default: a model sending "hold"
    // or "sell " must get an error, not an unexpected buy.
    if (args.side !== 'buy' && args.side !== 'sell') {
        throw new PaperError('INVALID_ARGUMENT', 'side 必须是 buy 或 sell');
    }
    if (args.type !== 'market' && args.type !== 'limit') {
        throw new PaperError('INVALID_ARGUMENT', 'type 必须是 market 或 limit');
    }
    return {
        symbol: String(args.symbol ?? ''),
        side: args.side,
        type: args.type,
        qty: Number(args.qty ?? 0),
        limitPrice: typeof args.limitPrice === 'number' ? args.limitPrice : undefined,
        price: typeof args.price === 'number' ? args.price : undefined,
        note: typeof args.note === 'string' && args.note.trim() !== '' ? args.note.trim().slice(0, 120) : undefined,
    };
}
function fail(error) {
    if (error instanceof PaperError)
        return { summary: `失败：${error.code} ${error.message}`, data: { error: { code: error.code, message: error.message } } };
    return { summary: `失败：${error instanceof Error ? error.message : String(error)}`, data: { error: String(error) } };
}
/** Register the eight `paper_*` tools. All of them go through PaperService. */
export function registerPaperTools(tools, service) {
    const base = {
        parameters,
        output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: String(value?.summary ?? '') }] },
    };
    tools.register(defineTool({
        ...base,
        name: 'paper_account',
        description: '查询模拟盘账户；reset=true 且 confirm=true 时重置账户。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const account = input.reset === true
                    ? await service.reset(input.confirm === true)
                    : await service.account();
                return { summary: renderAccount(account), data: account };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_export',
        parameters: noParameters,
        description: '查看账本文件位置与锁定原因，用于手动修复账本。',
        async execute() {
            try {
                const status = await service.ledgerStatus();
                const lines = [
                    `账本 ${status.path}${status.exists ? '' : '（尚未创建）'}`,
                    status.blocked ? `已锁定 · 原因：${status.blockedReason ?? '未记录'}` : '账户正常',
                ];
                if (status.blocked) {
                    lines.push(`备份目录 ${join(dirname(status.path), 'backups')}`);
                    lines.push('修复后需完全退出并重开 DSH；也可 paper_account reset=true, confirm=true（会先备份）');
                }
                return { summary: lines.join('\n'), data: status };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_quote',
        description: '查询证券最新行情（现价、买一、卖一、昨收）。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const symbols = Array.isArray(input.symbols) ? input.symbols.map(String) : [String(input.symbol ?? '')];
                const result = await service.quote(symbols.filter(Boolean));
                const lines = result.quotes.map(quote => `${formatSymbol(quote.symbol, quote.name)} 现价 ${quote.last.toFixed(2)}`);
                return { summary: lines.length > 0 ? lines.join('\n') : `行情不可用：${result.notice ?? result.state}`, data: result };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_preview',
        description: '下单前预览：金额、佣金、印花税、过户费、成交后现金、可卖与最大可买。',
        async execute(args) {
            try {
                const preview = await service.preview(draftOf((args ?? {})));
                return { summary: renderPreview(preview), data: preview };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_order',
        description: '提交模拟买卖单：支持市价与限价；买入按 100 股整数倍，卖出受 T+1 可卖限制。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const requestId = typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : undefined;
                const order = await service.place(draftOf(input), requestId);
                return { summary: renderOrder(order), data: order };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_cancel',
        description: '撤销一笔挂单。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const order = await service.cancel(String(input.orderId ?? ''));
                return { summary: renderOrder(order), data: order };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_status',
        description: '查看账户、持仓、挂单与最近成交。',
        async execute() {
            try {
                const [account, orders, trades] = await Promise.all([service.account(), service.orders(), service.trades()]);
                const pending = orders.filter(order => order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled');
                const lines = [
                    renderAccount(account),
                    pending.length > 0 ? `挂单 ${pending.length} 笔：\n${pending.map(renderOrder).join('\n')}` : '无挂单',
                    trades.length > 0 ? `最近成交：\n${trades.slice(0, 5).map(item => `- ${item.ts} ${item.side === 'buy' ? '买' : '卖'} ${formatSymbol(item.symbol, item.name)} ${item.qty}@${item.price.toFixed(2)}`).join('\n')}` : '无成交',
                ];
                return { summary: lines.join('\n\n'), data: { account, orders, trades } };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_tick',
        description: '刷新挂单与持仓行情，撮合可成交的限价单并处理过期。',
        async execute() {
            try {
                const result = await service.tick();
                const lines = [
                    `刷新完成：${result.tradeDate}`,
                    result.filled.length > 0 ? `成交 ${result.filled.length} 笔：\n${result.filled.map(renderOrder).join('\n')}` : '无成交',
                    result.expired.length > 0 ? `过期 ${result.expired.length} 笔` : '',
                    result.notices.length > 0 ? `提示：${result.notices.join('；')}` : '',
                ].filter(Boolean);
                return { summary: lines.join('\n'), data: result };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_market',
        description: '查询交易时段、搜索标的或查看全市场列表。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const action = input.action === 'search' || input.action === 'list' ? input.action : 'status';
                if (action === 'status') {
                    const status = await service.marketStatus();
                    return { summary: `时段 ${status.phase} · 交易日 ${status.tradeDate} · ${status.canMatch ? '可连续交易' : '不可连续成交'}`, data: status };
                }
                if (action === 'search') {
                    const hits = await service.search(String(input.query ?? ''), typeof input.limit === 'number' ? input.limit : 10);
                    return { summary: hits.length === 0 ? '没有匹配的标的' : hits.map(hit => formatSymbol(hit.symbol, hit.name)).join('\n'), data: hits };
                }
                const page = await service.marketList({
                    board: typeof input.board === 'string' ? input.board : undefined,
                    page: typeof input.page === 'number' ? input.page : 1,
                    pageSize: typeof input.pageSize === 'number' ? input.pageSize : 50,
                });
                const lines = page.quotes.map(quote => `${formatSymbol(quote.symbol, quote.name)} ${quote.last.toFixed(2)}`);
                return { summary: lines.length === 0 ? (page.notice ?? '没有行情') : lines.join('\n'), data: page };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
    tools.register(defineTool({
        ...base,
        name: 'paper_review',
        description: '查看模拟盘复盘：权益曲线、最大回撤、成交统计与已实现盈亏。',
        async execute(args) {
            const input = (args ?? {});
            try {
                const period = input.period === '7d' || input.period === 'all' ? input.period : '30d';
                const review = await service.review(period);
                return { summary: renderReview(review), data: review };
            }
            catch (error) {
                return fail(error);
            }
        },
    }));
}
//# sourceMappingURL=tools.js.map