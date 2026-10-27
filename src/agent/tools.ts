/**
 * The seven `paper_stock_*` tools.
 *
 * Naming rule: `paper_<asset>_<action>`, parallel to `paper_futures_*` in
 * `futures-tools.ts`. Every tool declares only the parameters it reads: the
 * previous shared property map made every tool advertise `reset`, `side` or
 * `period` that it never looked at, which cost prompt tokens and invited
 * wrong calls.
 *
 * All of them go through {@link PaperService}.
 * @module @dsh-ft/dsh-fft-paper-trading/agent/tools
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineJsonTool as defineTool } from './json-tools.js'
import type { OrderDraft } from '../contract.js'
import type { PaperService } from '../service/paper-service.js'
import { PaperError } from '../service/errors.js'
import { formatSymbol } from '../core/symbol.js'
import { renderAccount, renderOrder, renderPreview, renderReview } from './format.js'

export interface ToolsLike {
  register(tool: unknown): unknown
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    data: { type: 'json' },
  },
} as const satisfies ValueSchemaSpec

/** One definition per property; each tool composes only what it reads. */
const param = {
  symbol: { type: 'string', description: '证券代码（含市场），例如 600519.SH、000001.SZ；裸 6 位按股票解析' },
  symbols: { type: 'array', items: { type: 'string' }, description: '证券代码列表（含市场），例如 [600519.SH, 000001.SZ]' },
  side: { type: 'string', description: 'buy 或 sell' },
  type: { type: 'string', description: 'market 或 limit' },
  qty: { type: 'number', description: '数量（股）' },
  limitPrice: { type: 'number', description: '限价单价格' },
  price: { type: 'number', description: '无行情时的参考价（仅市价单）' },
  orderId: { type: 'string', description: '订单 ID' },
  requestId: { type: 'string', description: '幂等请求 ID；重复调用返回同一订单' },
  note: { type: 'string', description: '备注，最多 120 字' },
  period: { type: 'string', description: '复盘区间：7d、30d、all' },
  reset: { type: 'boolean', description: '是否重置账户' },
  confirm: { type: 'boolean', description: '重置时必须为 true' },
  action: { type: 'string', description: '动作：status 查交易时段 / search 搜标的' },
  query: { type: 'string', description: '搜索关键词（代码或名称）' },
  limit: { type: 'number', description: '返回条数上限，默认 10' },
} as const satisfies ParameterSchemaSpec

/** Mark one property required so DSH rejects a bad call before it reaches the service. */
function required<T extends ValueSchemaSpec>(property: T): T & { required: true } {
  return { ...property, required: true }
}

const accountParameters = { reset: param.reset, confirm: param.confirm } satisfies ParameterSchemaSpec
const marketParameters = { action: param.action, query: param.query, limit: param.limit } satisfies ParameterSchemaSpec
const quoteParameters = { symbol: param.symbol, symbols: param.symbols } satisfies ParameterSchemaSpec
const previewParameters = {
  symbol: required(param.symbol),
  side: required(param.side),
  type: required(param.type),
  qty: required(param.qty),
  limitPrice: param.limitPrice,
  price: param.price,
} satisfies ParameterSchemaSpec
const orderParameters = {
  ...previewParameters,
  requestId: param.requestId,
  note: param.note,
} satisfies ParameterSchemaSpec
const cancelParameters = { orderId: required(param.orderId) } satisfies ParameterSchemaSpec
const reviewParameters = { period: param.period } satisfies ParameterSchemaSpec

function draftOf(args: Record<string, unknown>): OrderDraft {
  // Never coerce an unknown side/type to a default: a model sending "hold"
  // or "sell " must get an error, not an unexpected buy.
  if (args.side !== 'buy' && args.side !== 'sell') {
    throw new PaperError('INVALID_ARGUMENT', 'side 必须是 buy 或 sell')
  }
  if (args.type !== 'market' && args.type !== 'limit') {
    throw new PaperError('INVALID_ARGUMENT', 'type 必须是 market 或 limit')
  }
  return {
    symbol: String(args.symbol ?? ''),
    side: args.side,
    type: args.type,
    qty: Number(args.qty ?? 0),
    limitPrice: typeof args.limitPrice === 'number' ? args.limitPrice : undefined,
    price: typeof args.price === 'number' ? args.price : undefined,
    note: typeof args.note === 'string' && args.note.trim() !== '' ? args.note.trim().slice(0, 120) : undefined,
  }
}

type ToolResult = { summary: string; data: any }

function fail(error: unknown): ToolResult {
  if (error instanceof PaperError) return { summary: `失败：${error.code} ${error.message}`, data: { error: { code: error.code, message: error.message } } }
  return { summary: `失败：${error instanceof Error ? error.message : String(error)}`, data: { error: String(error) } }
}

/** Register the seven `paper_stock_*` tools. All of them go through PaperService. */
export function registerPaperTools(tools: ToolsLike, service: PaperService): void {
  const base = {
    output: { schema: outputSchema, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String((value as { summary?: string })?.summary ?? '') }] },
  }

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_account',
    parameters: accountParameters,
    description: '查看模拟盘账户、持仓、挂单与最近成交；reset=true 且 confirm=true 时重置账户。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const account = input.reset === true
          ? await service.reset(input.confirm === true)
          : await service.account()
        const [orders, trades] = await Promise.all([service.orders(), service.trades()])
        const pending = orders.filter(order => order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled')
        const lines = [
          renderAccount(account),
          pending.length > 0 ? `挂单 ${pending.length} 笔：\n${pending.map(renderOrder).join('\n')}` : '无挂单',
          trades.length > 0 ? `最近成交：\n${trades.slice(0, 5).map(item => `- ${item.ts} ${item.side === 'buy' ? '买' : '卖'} ${formatSymbol(item.symbol, item.name)} ${item.qty}@${item.price.toFixed(2)}`).join('\n')}` : '无成交',
        ]
        return { summary: lines.join('\n\n'), data: { account, orders, trades } }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_market',
    parameters: marketParameters,
    description: '查询交易时段（action=status）或搜索标的（action=search）。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        if (input.action !== 'search') {
          const status = await service.marketStatus()
          const calendar = status.calendar?.source === 'fallback' ? ' · 交易日历降级（按工作日估算）' : ''
          return { summary: `时段 ${status.phase} · 交易日 ${status.tradeDate} · ${status.canMatch ? '可连续交易' : '不可连续成交'}${calendar}`, data: status }
        }
        const hits = await service.search(String(input.query ?? ''), typeof input.limit === 'number' ? input.limit : 10)
        return { summary: hits.length === 0 ? '没有匹配的标的' : hits.map(hit => formatSymbol(hit.symbol, hit.name)).join('\n'), data: hits }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_quote',
    parameters: quoteParameters,
    description: '查询证券最新行情（现价、买一、卖一、昨收）。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const symbols = Array.isArray(input.symbols) ? input.symbols.map(String) : [String(input.symbol ?? '')]
        const result = await service.quote(symbols.filter(Boolean))
        const lines = result.quotes.map(quote => {
          // A quote recovered from the daily candles is a close, not a live tick;
          // calling it 现价 would make the model quote a stale number as current.
          const price = quote.source === 'daily-bar' ? `收盘 ${quote.last.toFixed(2)}（日K）` : `现价 ${quote.last.toFixed(2)}`
          return `${formatSymbol(quote.symbol, quote.name)} ${price}`
        })
        // `notice` is already a whole sentence ("免费行情额度已用尽…"), so prefixing
        // it with 行情不可用 would only repeat the word.
        return { summary: lines.length > 0 ? lines.join('\n') : (result.notice ?? '行情不可用'), data: result }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_preview',
    parameters: previewParameters,
    description: '下单前预览：金额、佣金、印花税、过户费、成交后现金、可卖与最大可买。',
    async execute(args: unknown): Promise<ToolResult> {
      try {
        const preview = await service.preview(draftOf((args ?? {}) as Record<string, unknown>))
        return { summary: renderPreview(preview), data: preview }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_order',
    parameters: orderParameters,
    description: '提交模拟买卖单：支持市价与限价；买入按 100 股整数倍，卖出受 T+1 可卖限制。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const requestId = typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : undefined
        const order = await service.place(draftOf(input), requestId)
        return { summary: renderOrder(order), data: order }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_cancel',
    parameters: cancelParameters,
    description: '撤销一笔股票挂单。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const order = await service.cancel(String(input.orderId ?? ''))
        return { summary: renderOrder(order), data: order }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_stock_review',
    parameters: reviewParameters,
    description: '查看模拟盘复盘：权益曲线、最大回撤、成交统计与已实现盈亏。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const period = input.period === '7d' || input.period === 'all' ? input.period : '30d'
        const review = await service.review(period)
        return { summary: renderReview(review), data: review }
      } catch (error) {
        return fail(error)
      }
    },
  }))
}
