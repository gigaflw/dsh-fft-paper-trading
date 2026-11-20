import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FuturesService } from '../service/futures-service.js'
import type { PaperService } from '../service/paper-service.js'
import type { ToolsLike } from './tools.js'
import { defineJsonTool as defineTool } from './json-tools.js'
import { toolFailure as fail } from './tool-result.js'

/**
 * One recovery tool for both books.
 *
 * The point of this tool is delegation: a user who cannot repair a ledger says
 * "帮我恢复", and the agent can list snapshots, pick the newest restorable one
 * and swap it in without leaving DSH. Keeping it read-only for status and
 * explicit (`confirm: true`) for restore keeps a model from overwriting an
 * account by accident.
 *
 * @module @dsh-ft/dsh-fft-paper-trading/agent/ledger-tools
 */

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    data: { type: 'json' },
  },
} as const satisfies ValueSchemaSpec

const parameters = {
  account: { type: 'string', description: '账本：stock（股票，默认）或 futures（期货）' },
  action: { type: 'string', description: '动作：list（列出快照）、restore（恢复快照）、backup（立即备份）' },
  name: { type: 'string', description: 'restore 时的快照文件名，取自 list 结果的 name' },
  confirm: { type: 'boolean', description: 'restore 时必须为 true' },
} as const satisfies ParameterSchemaSpec

type ToolResult = { summary: string; data: any }


function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function accountSummary(view: Record<string, unknown>): string {
  const positions = Array.isArray(view.positions) ? view.positions.length : 0
  const parts = [
    `现金 ${number(view.cash).toFixed(2)}`,
    `总资产 ${number(view.equity).toFixed(2)}`,
    `持仓 ${positions} 只`,
    `交易日 ${String(view.tradeDate ?? '—')}`,
    view.blocked === true ? '仍处于锁定状态' : '可继续交易',
  ]
  return parts.join(' · ')
}

function snapshotLine(snapshot: Record<string, unknown>): string {
  const state = snapshot.valid === true ? '可恢复' : `不可恢复（${String(snapshot.problem ?? '原因未记录')}）`
  const migrate = snapshot.migratable === true ? ' · 需迁移版本' : ''
  const stamp = String(snapshot.createdAt ?? '').replace('T', ' ').replace(/\..*$/, '')
  return `- ${String(snapshot.name)} · ${stamp} · v${String(snapshot.ledgerVersion)} · seq ${String(snapshot.lastSeq)} · 交易日 ${String(snapshot.tradeDate)} · 现金 ${number(snapshot.cash).toFixed(2)} · ${state}${migrate}`
}

/**
 * One ledger, whichever plane or stock account it belongs to.
 *
 * `account` is the same reference other tools use (display name or id); the
 * legacy family keywords `stock` / `futures` still work, and an omitted value
 * means the default stock account.
 */
export interface LedgerTarget {
  kind: 'stock' | 'futures'
  service: PaperService | FuturesService
  /** Registry id of the resolved ledger, for the tool's structured output. */
  accountId: string
}

/** Register `paper_ledger`, the recovery entry point for every ledger. */
export function registerLedgerTools(
  tools: ToolsLike,
  services: { resolve: (reference?: string) => Promise<LedgerTarget> },
): void {
  const base = {
    parameters,
    output: {
      schema: outputSchema,
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String((value as { summary?: string })?.summary ?? '') }],
    },
  }

  tools.register(defineTool({
    ...base,
    name: 'paper_ledger',
    description: '查看账本状态与可恢复快照并恢复（默认股票账户，可指定账户名/id 或 stock/futures，进程内生效，无需重启）；恢复前需账户未锁定。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      try {
        const reference = typeof input.account === 'string' ? input.account.trim() : undefined
        const target = await services.resolve(reference)
        const account = target.service
        const futures = target.kind === 'futures'
        const action = input.action === 'restore' || input.action === 'backup' ? input.action : 'list'
        if (action === 'restore') {
          const name = typeof input.name === 'string' ? input.name.trim() : ''
          if (name === '') return { summary: '失败：restore 需要 name（先用 action=list 查看快照）', data: { error: 'missing name' } }
          if (input.confirm !== true) return { summary: '失败：restore 需要 confirm=true', data: { error: 'missing confirm' } }
          const view = await account.restoreLedger(name, true) as unknown as Record<string, unknown>
          const data = { account: target.kind, accountId: target.accountId, name, view }
          return { summary: `已恢复 ${name}\n${accountSummary(view)}`, data }
        }
        if (action === 'backup') {
          const backedUp = await account.backupLedger()
          return {
            summary: backedUp ? '已备份当前账本到 backups/' : '账本尚未创建，无需备份',
            data: { account: target.kind, accountId: target.accountId, backedUp },
          }
        }
        const view = await account.ledgerSnapshots()
        const restorable = view.snapshots.filter(snapshot => snapshot.valid).length
        const header = [
          `账本 ${view.path}${futures ? '（期货）' : `（${target.accountId === 'default' ? '股票' : target.accountId}）`}`,
          view.blocked
            ? `已锁定 · 原因：${view.blockedReason ?? '未记录'}`
            : '账户正常',
          `当前版本 v${String(view.ledgerVersion ?? '?')} · 快照 ${view.snapshots.length} 份（可恢复 ${restorable} 份）`,
        ]
        const lines = [...header, ...view.snapshots.slice(0, 10).map(snapshot => snapshotLine(snapshot as unknown as Record<string, unknown>))]
        if (view.snapshots.length > 10) lines.push(`…另有 ${view.snapshots.length - 10} 份未显示`)
        if (restorable > 0) lines.push('恢复：paper_ledger { account, action: "restore", name: "<文件名>", confirm: true }')
        else lines.push('没有可恢复的快照：只能导出账本或重置账户')
        return {
          summary: lines.join('\n'),
          data: { account: target.kind, accountId: target.accountId, ...view },
        }
      } catch (error) {
        return fail(error)
      }
    },
  }))
}
