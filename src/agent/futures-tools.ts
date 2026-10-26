/**
 * The eight `futures_*` tools (D10).
 *
 * Same shape as `paper_*` — a one-paragraph Chinese summary plus the structured
 * view — but the vocabulary is futures (手, 开/平, 多/空) so the model never
 * confuses lots with shares. All of them go through {@link FuturesService}.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/agent/futures-tools
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineJsonTool as defineTool } from './json-tools.js'
import type {
  FuturesAccountView,
  FuturesContractView,
  FuturesDraft,
  FuturesExchange,
  FuturesOrderView,
  FuturesPositionView,
  FuturesPreviewView,
  FuturesQuoteView,
  FuturesReviewView,
} from '../futures-contract.js'
import type { FuturesService } from '../service/futures-service.js'
import { FuturesError } from '../service/futures-service.js'
import type { ToolsLike } from './tools.js'

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    data: { type: 'json' },
  },
} as const satisfies ValueSchemaSpec

const parameters = {
  symbol: { type: 'string', description: '合约代码（行情口径），例如 RB2611.SHFE' },
  symbols: { type: 'array', items: { type: 'string' }, description: '合约代码列表' },
  side: { type: 'string', description: '方向：long（多）或 short（空）' },
  offset: { type: 'string', description: '开平：open 或 close' },
  type: { type: 'string', description: 'market 或 limit' },
  qty: { type: 'number', description: '手数（正整数）' },
  limitPrice: { type: 'number', description: '限价单价格' },
  price: { type: 'number', description: '无行情时的参考价（仅市价平仓）' },
  orderId: { type: 'string', description: '订单 ID' },
  requestId: { type: 'string', description: '幂等请求 ID；重复调用返回同一订单' },
  period: { type: 'string', description: '复盘区间：7d、30d、all' },
  query: { type: 'string', description: '合约搜索关键词（代码/品种/中文名）' },
  exchange: { type: 'string', description: '交易所：SHFE / INE / DCE / CZCE / GFEX' },
  limit: { type: 'number', description: '返回合约数量上限' },
  refresh: { type: 'boolean', description: '强制刷新合约索引' },
  reset: { type: 'boolean', description: '是否重置期货账户' },
  confirm: { type: 'boolean', description: '重置时必须为 true' },
  note: { type: 'string', description: '备注，最多 120 字' },
} as const satisfies ParameterSchemaSpec

type ToolResult = { summary: string; data: any }

function money(cents: number | undefined): string {
  return cents === undefined ? '—' : (cents / 100).toFixed(2)
}

function pct(ratio: number | undefined): string {
  return ratio === undefined ? '—' : `${(ratio * 100).toFixed(2)}%`
}

function sideText(side: 'long' | 'short'): string {
  return side === 'long' ? '多' : '空'
}

function offsetText(offset: 'open' | 'close'): string {
  return offset === 'open' ? '开' : '平'
}

function orderStatusText(status: FuturesOrderView['status']): string {
  const map: Record<FuturesOrderView['status'], string> = {
    pending: '挂单中',
    filled: '已成交',
    canceled: '已撤单',
    rejected: '已拒绝',
    expired: '已过期',
  }
  return map[status]
}

function renderAccount(account: FuturesAccountView): string {
  const lines = [
    `期货账户 · 交易日 ${account.tradeDate}${account.blocked ? ' · 已锁定' : ''}`,
    `总权益 ${account.equity.toFixed(2)} · 可用资金 ${account.cash.toFixed(2)} · 保证金 ${account.margin.toFixed(2)} · 风险度 ${pct(account.riskRatio)}`,
    `累计盈亏 ${account.pnl >= 0 ? '+' : ''}${account.pnl.toFixed(2)} (${(account.pnlPct * 100).toFixed(2)}%) · 当日盈亏 ${account.todayPnl >= 0 ? '+' : ''}${account.todayPnl.toFixed(2)}`,
  ]
  if (account.blocked) {
    lines.push(`锁定原因：${account.blockedReason ?? '未记录'}`)
    if (account.ledgerPath !== undefined) lines.push(`账本：${account.ledgerPath}`)
    lines.push('修复后可 futures_account reset=true, confirm=true（会先备份）')
  }
  if (account.positions.length === 0) lines.push('无持仓')
  else {
    lines.push(`持仓 ${account.positions.length} 笔：`)
    for (const position of account.positions) {
      lines.push(`- ${position.symbol} ${sideText(position.side)} ${position.qty} 手（今仓 ${position.todayQty}）均价 ${position.avgPrice} 最新 ${position.lastPrice ?? '—'} 浮盈亏 ${money(position.unrealizedPnlCents)} 保证金 ${money(position.marginCents)}`)
    }
  }
  return lines.join('\n')
}

function renderOrder(order: FuturesOrderView): string {
  const parts = [`${orderStatusText(order.status)}：${sideText(order.side)}${offsetText(order.offset)} ${order.symbol} ${order.qty} 手`]
  if (order.type === 'limit' && order.limitPrice !== undefined) parts.push(`限价 ${order.limitPrice}`)
  if (order.fillPrice !== undefined) parts.push(`成交价 ${order.fillPrice}`)
  if (order.feesCents !== undefined) parts.push(`手续费 ${money(order.feesCents)}`)
  if (order.reason !== undefined) parts.push(`原因 ${order.reason}`)
  if (order.note !== undefined) parts.push(`备注 ${order.note}`)
  return parts.join(' · ')
}

function renderPositions(positions: FuturesPositionView[]): string {
  if (positions.length === 0) return '无持仓'
  return positions.map(position =>
    `- ${position.symbol} ${sideText(position.side)} ${position.qty} 手（今仓 ${position.todayQty}）均价 ${position.avgPrice} 最新 ${position.lastPrice ?? '—'} 浮盈亏 ${money(position.unrealizedPnlCents)} 保证金 ${money(position.marginCents)}${position.deListDate === undefined ? '' : ` 到期 ${position.deListDate}`}`,
  ).join('\n')
}

function renderPreview(preview: FuturesPreviewView): string {
  const lines = [
    `预览：${sideText(preview.side)}${offsetText(preview.offset)} ${preview.symbol} ${preview.qty} 手 @ ${preview.price}`,
    `名义金额 ${money(preview.amountCents)} · 保证金 ${money(preview.marginCents)} · 手续费 ${money(preview.feesCents)} · 占用后可用 ${money(preview.cashAfterCents)}`,
    `最大可开 ${preview.maxOpenQty} 手 · 可平 ${preview.availableCloseQty} 手 · 风险度 ${pct(preview.riskRatioAfter)}`,
  ]
  if (preview.limit !== undefined) lines.push(`涨跌停 ${preview.limit.lower}–${preview.limit.upper}`)
  if (preview.session !== undefined) lines.push(`时段 ${preview.session.phase}${preview.session.canMatch ? ' · 可成交' : ' · 不可成交'}`)
  if (preview.warnings.length > 0) lines.push(`提示：${preview.warnings.join('；')}`)
  return lines.join('\n')
}

function renderContracts(contracts: FuturesContractView[]): string {
  if (contracts.length === 0) return '没有匹配的合约'
  return contracts.map(contract =>
    `${contract.symbol} ${contract.name ?? ''} 乘数 ${contract.multiplier} tick ${contract.tickSize}${contract.marginRate === undefined ? '' : ` 保证金率 ${pct(contract.marginRate)}`}${contract.deListDate === undefined ? '' : ` 到期 ${contract.deListDate}`}`,
  ).join('\n')
}

function renderQuotes(quotes: FuturesQuoteView[]): string {
  if (quotes.length === 0) return '行情不可用'
  return quotes.map(quote =>
    `${quote.symbol} ${quote.name ?? ''} 最新 ${quote.last}${quote.preSettlement === undefined ? '' : ` 昨结 ${quote.preSettlement}`}${quote.volume === undefined ? '' : ` 成交量 ${quote.volume}`}${quote.openInterest === undefined ? '' : ` 持仓量 ${quote.openInterest}`}`,
  ).join('\n')
}

function renderReview(review: FuturesReviewView): string {
  return [
    `期货复盘 · 成交 ${review.tradeCount} 笔（开 ${review.openCount} / 平 ${review.closeCount}，盈 ${review.winCount} / 亏 ${review.lossCount}）`,
    `已实现盈亏 ${review.realizedPnl.toFixed(2)} · 手续费合计 ${review.totalFees.toFixed(2)} · 最大回撤 ${(review.maxDrawdownPct * 100).toFixed(2)}%`,
    review.byProduct.length === 0 ? '' : `分品种：${review.byProduct.map(item => `${item.product} ${item.tradeCount} 笔 ${item.realizedPnl.toFixed(2)}`).join('；')}`,
  ].filter(Boolean).join('\n')
}

function draftOf(args: Record<string, unknown>): FuturesDraft {
  // Coercing a bad side to long would open the opposite position; reject it.
  if (args.side !== 'long' && args.side !== 'short') {
    throw new FuturesError('INVALID_ARGUMENT', 'side 必须是 long 或 short')
  }
  if (args.offset !== 'open' && args.offset !== 'close') {
    throw new FuturesError('INVALID_ARGUMENT', 'offset 必须是 open 或 close')
  }
  if (args.type !== 'market' && args.type !== 'limit') {
    throw new FuturesError('INVALID_ARGUMENT', 'type 必须是 market 或 limit')
  }
  return {
    symbol: String(args.symbol ?? ''),
    side: args.side,
    offset: args.offset,
    type: args.type,
    qty: Number(args.qty ?? 0),
    limitPrice: typeof args.limitPrice === 'number' ? args.limitPrice : undefined,
    price: typeof args.price === 'number' ? args.price : undefined,
    note: typeof args.note === 'string' && args.note.trim() !== '' ? args.note.trim().slice(0, 120) : undefined,
  }
}

function fail(error: unknown): ToolResult {
  if (error instanceof FuturesError) {
    return { summary: `失败：${error.code} ${error.message}`, data: { error: { code: error.code, message: error.message } } }
  }
  return { summary: `失败：${error instanceof Error ? error.message : String(error)}`, data: { error: String(error) } }
}

/** Register the eight `futures_*` tools. */
export function registerFuturesTools(tools: ToolsLike, service: FuturesService): void {
  const base = {
    parameters,
    output: { schema: outputSchema, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String((value as { summary?: string })?.summary ?? '') }] },
  }

  tools.register(defineTool({
    ...base,
    name: 'futures_account',
    description: '查询期货模拟账户（权益/可用/保证金/风险度/持仓）；reset=true 且 confirm=true 时重置。',
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
    name: 'futures_contracts',
    description: '搜索期货合约（代码/品种/中文名），返回乘数、tick、保证金率与到期日。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const result = await service.contracts({
          query: typeof input.query === 'string' ? input.query : undefined,
          exchange: typeof input.exchange === 'string' ? input.exchange as FuturesExchange : undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          refresh: input.refresh === true,
        })
        // A stale cache is still "available": printing 合约索引不可用 in front of
        // "…沿用 X 缓存" contradicted the notice and repeated the wording.
        const summary = result.state === 'ok' || result.contracts.length > 0
          ? renderContracts(result.contracts)
          : (result.notice ?? '合约索引不可用')
        return { summary, data: result }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'futures_quote',
    description: '查询期货合约最新行情（最新价、昨结、成交量、持仓量）。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const symbols = Array.isArray(input.symbols) ? input.symbols.map(String) : [String(input.symbol ?? '')]
        const result = await service.quote(symbols.filter(Boolean))
        // `notice` is already a whole sentence; prefixing would only repeat 行情不可用.
        const summary = result.quotes.length > 0 ? renderQuotes(result.quotes) : (result.notice ?? '行情不可用')
        return { summary, data: result }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'futures_preview',
    description: '开平仓前预览：保证金、手续费、占用后可用、最大可开手数、涨跌停与风险度。',
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
    name: 'futures_order',
    description: '提交期货委托：开多/开空/平多/平空 × 市价/限价，qty 单位手，requestId 幂等。',
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
    name: 'futures_cancel',
    description: '撤销一笔期货挂单。',
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
    name: 'futures_positions',
    description: '查看期货持仓与挂单：按合约×方向分行，显示手数、今仓、均价、浮盈亏与保证金。',
    async execute(): Promise<ToolResult> {
      try {
        const [account, orders] = await Promise.all([service.account(), service.orders()])
        const pending = orders.filter(order => order.status === 'pending')
        const lines = [
          renderAccount(account),
          pending.length > 0 ? `挂单 ${pending.length} 笔：\n${pending.map(renderOrder).join('\n')}` : '无挂单',
        ]
        return { summary: lines.join('\n\n'), data: { account, orders, positions: account.positions } }
      } catch (error) {
        return fail(error)
      }
    },
  }))

  tools.register(defineTool({
    ...base,
    name: 'futures_review',
    description: '查看期货复盘：权益曲线、最大回撤、开平仓统计、已实现盈亏与分品种统计。',
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

export { renderAccount, renderPositions, renderPreview, renderReview, renderOrder }
