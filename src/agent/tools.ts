import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { OrderDraft } from '../contract.js'
import type { PaperService } from '../service/paper-service.js'
import { PaperError } from '../service/errors.js'
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

const parameters = {
  symbol: { type: 'string', description: '证券代码，例如 600519' },
  symbols: { type: 'array', items: { type: 'string' }, description: '证券代码列表' },
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
} as const satisfies ParameterSchemaSpec

function draftOf(args: Record<string, unknown>): OrderDraft {
  return {
    symbol: String(args.symbol ?? ''),
    side: args.side === 'sell' ? 'sell' : 'buy',
    type: args.type === 'limit' ? 'limit' : 'market',
    qty: Number(args.qty ?? 0),
    limitPrice: typeof args.limitPrice === 'number' ? args.limitPrice : undefined,
    price: typeof args.price === 'number' ? args.price : undefined,
  }
}

type ToolResult = { summary: string; data: any }

function fail(error: unknown): ToolResult {
  if (error instanceof PaperError) return { summary: `失败：${error.code} ${error.message}`, data: { error: { code: error.code, message: error.message } } }
  return { summary: `失败：${error instanceof Error ? error.message : String(error)}`, data: { error: String(error) } }
}

/** Register the eight `paper_*` tools. All of them go through PaperService. */
export function registerPaperTools(tools: ToolsLike, service: PaperService): void {
  const base = {
    parameters,
    output: { schema: outputSchema, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String((value as { summary?: string })?.summary ?? '') }] },
  }

  tools.register(defineTool({
    ...base,
    name: 'paper_account',
    description: '查询模拟盘账户；reset=true 且 confirm=true 时重置账户。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const account = input.reset === true
          ? await service.reset(input.confirm === true)
          : await service.account()
        return { summary: renderAccount(account), data: account }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_quote',
    description: '查询证券最新行情（现价、买一、卖一、昨收）。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const symbols = Array.isArray(input.symbols) ? input.symbols.map(String) : [String(input.symbol ?? '')]
        const result = await service.quote(symbols.filter(Boolean))
        const lines = result.quotes.map(quote => `${quote.symbol} ${quote.name ?? ''} 现价 ${quote.last.toFixed(2)} 买 ${quote.bid.toFixed(2)} 卖 ${quote.ask.toFixed(2)}`)
        return { summary: lines.length > 0 ? lines.join('\n') : `行情不可用：${result.notice ?? result.state}`, data: result }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_preview',
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
    name: 'paper_order',
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
    name: 'paper_cancel',
    description: '撤销一笔挂单。',
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
    name: 'paper_status',
    description: '查看账户、持仓、挂单与最近成交。',
    async execute(): Promise<ToolResult> {
      try {
        const [account, orders, trades] = await Promise.all([service.account(), service.orders(), service.trades()])
        const pending = orders.filter(order => order.status === 'pending')
        const lines = [
          renderAccount(account),
          pending.length > 0 ? `挂单 ${pending.length} 笔：\n${pending.map(renderOrder).join('\n')}` : '无挂单',
          trades.length > 0 ? `最近成交：\n${trades.slice(0, 5).map(item => `- ${item.ts} ${item.side === 'buy' ? '买' : '卖'} ${item.symbol} ${item.qty}@${item.price.toFixed(2)}`).join('\n')}` : '无成交',
        ]
        return { summary: lines.join('\n\n'), data: { account, orders, trades } }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_tick',
    description: '刷新挂单与持仓行情，撮合可成交的限价单并处理过期。',
    async execute(): Promise<ToolResult> {
      try {
        const result = await service.tick()
        const lines = [
          `刷新完成：${result.tradeDate}`,
          result.filled.length > 0 ? `成交 ${result.filled.length} 笔：\n${result.filled.map(renderOrder).join('\n')}` : '无成交',
          result.expired.length > 0 ? `过期 ${result.expired.length} 笔` : '',
          result.notices.length > 0 ? `提示：${result.notices.join('；')}` : '',
        ].filter(Boolean)
        return { summary: lines.join('\n'), data: result }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'paper_review',
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
