import type { AccountView, OrderView, PositionView, PreviewView, ReviewView } from '../contract.js'

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function renderAccount(account: AccountView): string {
  const lines = [
    `账户 ${account.accountId} · ${account.tradeDate}${account.blocked ? ' · 已锁定' : ''}`,
    `总资产 ${money(account.equity * 100)} · 现金 ${money(account.cash * 100)} · 盈亏 ${account.pnl >= 0 ? '+' : ''}${account.pnl.toFixed(2)} (${(account.pnlPct * 100).toFixed(2)}%)`,
  ]
  if (account.positions.length === 0) lines.push('无持仓')
  else {
    lines.push('持仓：')
    for (const position of account.positions) {
      lines.push(`- ${position.symbol} ${position.name ?? ''} ${position.qty} 股（可卖 ${position.available}）成本 ${position.avgCost.toFixed(2)} 现价 ${position.lastPrice?.toFixed(2) ?? '—'}`)
    }
  }
  return lines.join('\n')
}

export function renderPreview(preview: PreviewView): string {
  const lines = [
    `预览：${preview.side === 'buy' ? '买入' : '卖出'} ${preview.symbol} ${preview.qty} 股 @ ${preview.price.toFixed(2)}`,
    `金额 ${money(preview.amountCents)} · 费用 ${money(preview.totalFeesCents)}（佣金 ${money(preview.commissionCents)}，印花税 ${money(preview.stampCents)}，过户费 ${money(preview.transferCents)}）`,
    `成交后现金 ${money(preview.cashAfterCents)}`,
  ]
  if (preview.warnings.length > 0) lines.push(`提示：${preview.warnings.join('；')}`)
  return lines.join('\n')
}

export function renderOrder(order: OrderView): string {
  const status: Record<OrderView['status'], string> = {
    queued: '已排队',
    pending: '挂单中',
    partially_filled: '部分成交',
    filled: '已成交',
    canceled: '已撤单',
    rejected: '已拒绝',
    expired: '已过期',
  }
  const parts = [`${status[order.status]}：${order.side === 'buy' ? '买入' : '卖出'} ${order.symbol} ${order.qty} 股`]
  if (order.type === 'limit' && order.limitPrice !== undefined) parts.push(`限价 ${order.limitPrice.toFixed(2)}`)
  if (order.fillPrice !== undefined) parts.push(`成交价 ${order.fillPrice.toFixed(2)}`)
  if (order.reason !== undefined) parts.push(`原因 ${order.reason}`)
  return parts.join(' · ')
}

export function renderPositions(positions: PositionView[]): string {
  if (positions.length === 0) return '无持仓'
  return positions
    .map(item => `- ${item.symbol} ${item.name ?? ''} ${item.qty} 股（可卖 ${item.available}）成本 ${item.avgCost.toFixed(2)} 现价 ${item.lastPrice?.toFixed(2) ?? '—'} 浮盈亏 ${money(item.unrealizedPnlCents ?? 0)}`)
    .join('\n')
}

export function renderReview(review: ReviewView): string {
  return [
    `复盘 ${review.days} 天 · 成交 ${review.tradeCount} 笔（买 ${review.buyCount} / 卖 ${review.sellCount}）`,
    `已实现盈亏 ${review.realizedPnl.toFixed(2)} · 费用合计 ${review.totalFees.toFixed(2)} · 最大回撤 ${(review.maxDrawdownPct * 100).toFixed(2)}%`,
  ].join('\n')
}
