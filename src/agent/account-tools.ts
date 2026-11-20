/**
 * The `paper_account` tool: account list and administration.
 *
 * Trading tools take an `account` argument; this tool is how a caller discovers
 * the names/ids and how the operator renames, hides or freezes an account from
 * the chat. Account notes are human-only and therefore have no tool. It knows nothing about sessions: there is no "bind",
 * no "current account" and no per-session state.
 * @module @dsh-ft/dsh-fft-paper-trading/agent/account-tools
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineJsonTool as defineTool } from './json-tools.js'
import type { AccountMeta } from '../contract.js'
import { PaperError } from '../service/errors.js'
import type { AccountRegistry } from '../store/accounts.js'
import { toolFailure as fail } from './tool-result.js'

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

const param = {
  action: {
    type: 'string',
    description: '动作：list 列出账户 / create 新建 / rename 改名 / hide 隐藏 / unhide 取消隐藏 / lock 锁定 / unlock 解锁',
  },
  name: { type: 'string', description: '账户名或 id；重名时用 id' },
  newName: { type: 'string', description: 'rename 时的新账户名（允许重名）' },
  initialCash: { type: 'number', description: 'create 时的初始资金（元），不填沿用默认 100 万' },
  includeHidden: { type: 'boolean', description: 'list 时是否包含已隐藏账户，默认 false' },
} as const satisfies ParameterSchemaSpec

const parameters = {
  action: { ...param.action, required: true },
  name: param.name,
  newName: param.newName,
  initialCash: param.initialCash,
  includeHidden: param.includeHidden,
} as const satisfies ParameterSchemaSpec

type ToolResult = { summary: string; data: any }


function stateOf(meta: AccountMeta): string {
  if (meta.missing === true) return '账本目录缺失'
  if (meta.hidden === true) return '已隐藏'
  if (meta.locked === true) return '已锁定'
  return '正常'
}

function renderList(accounts: readonly AccountMeta[], defaults: { stock: string; futures: string }): string {
  if (accounts.length === 0) return '没有账户'
  const lines = accounts.map(meta => {
    const marks = [meta.kind === 'futures' ? '期货' : '股票', stateOf(meta)]
    if (meta.id === defaults.stock || meta.id === defaults.futures) marks.push('默认')
    return `- ${meta.name}（${meta.id}）· ${marks.join(' · ')}`
  })
  return `账户 ${accounts.length} 个：\n${lines.join('\n')}`
}

/** Register `paper_account`; it is the only tool that mutates the registry. */
export function registerAccountTools(tools: ToolsLike, deps: { registry: AccountRegistry }): void {
  tools.register(defineTool({
    output: {
      schema: outputSchema,
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String((value as { summary?: string })?.summary ?? '') }],
    },
    name: 'paper_account',
    parameters,
    description: '模拟盘账户管理：列出、新建、改名、隐藏、锁定账户。交易工具用 account 参数指定账户；不传就是默认账户，插件没有「当前账户」概念。备注/笔记只能由人在面板里写。',
    async execute(args: unknown): Promise<ToolResult> {
      const input = (args ?? {}) as Record<string, unknown>
      const action = typeof input.action === 'string' ? input.action : ''
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      const initialCash = typeof input.initialCash === 'number' && input.initialCash > 0 ? input.initialCash : undefined
      try {
        if (action !== 'list' && action !== 'create' && name === '') {
          // An omitted name used to fall back to the default account, so a
          // model could hide or lock it by accident.
          throw new PaperError('INVALID_ARGUMENT', `${action || '该动作'} 需要 name（账户名或 id）`)
        }
        switch (action) {
          case 'list': {
            const view = await deps.registry.view({ includeHidden: input.includeHidden === true })
            return { summary: renderList(view.accounts, view.defaultIds), data: view }
          }
          case 'create': {
            const meta = await deps.registry.create({
              name,
              ...(initialCash === undefined ? {} : { initialCashCents: Math.round(initialCash * 100) }),
            })
            return {
              summary: `已创建账户「${meta.name}」（${meta.id}），初始资金 ${initialCash === undefined ? '默认 100 万' : `${initialCash} 元`}。交易时把 account 设成这个账户名或 id。`,
              data: meta,
            }
          }
          case 'rename': {
            const next = typeof input.newName === 'string' ? input.newName.trim() : ''
            if (next === '') throw new PaperError('INVALID_ARGUMENT', 'rename 需要 newName')
            const meta = await deps.registry.rename(name, next)
            return { summary: `账户已改名为「${meta.name}」（${meta.id}）；用旧名字的交易调用会找不到它。`, data: meta }
          }
          case 'hide': {
            const meta = await deps.registry.hide(name)
            return { summary: `已隐藏账户「${meta.name}」；面板下拉与对比页不再显示，按 id 仍可交易。`, data: meta }
          }
          case 'unhide': {
            const meta = await deps.registry.unhide(name)
            return { summary: `已取消隐藏「${meta.name}」。`, data: meta }
          }
          case 'lock': {
            const meta = await deps.registry.lock(name)
            return { summary: `已锁定账户「${meta.name}」：只能查看、复盘与导出，不能下单或出入金。`, data: meta }
          }
          case 'unlock': {
            const meta = await deps.registry.unlock(name)
            return { summary: `已解锁账户「${meta.name}」。`, data: meta }
          }
          default:
            throw new PaperError('INVALID_ARGUMENT', `未知动作 ${action || '(空)'}；可用 list/create/rename/hide/unhide/lock/unlock`)
        }
      } catch (error) {
        return fail(error)
      }
    },
  }))
}
