/**
 * Basket allocation: CSV → parse → budget split into 100-share lots.
 *
 * Everything here is a pure function over its input (no ledger, no clock, no
 * market data); the service owns IO and error codes. That keeps the fee, lot
 * and normalisation rules in one testable place and lets the preview and the
 * eventual agent tool share the exact same arithmetic.
 * @module @ft/dsh-fft-paper-trading/core/basket
 */

import type { BasketIssue, BasketPlanRow, PaperSettings, Quote } from '../contract.js'
import { amountCents, roundPrice } from './money.js'
import { computeFees } from './fees.js'

/** v1 cap: a basket is read at a glance and quotes are fetched one by one. */
export const MAX_BASKET_SYMBOLS = 20

/** Weight sums are floating point; only differences above this are "off 100%". */
const WEIGHT_EPSILON = 1e-9

/** One parsed CSV row before allocation. */
export interface BasketCsvRow {
  symbol: string
  /** Normalised across the file, so the weights sum to 1. */
  weight: number
}

/** `parseBasketCsv` output: usable rows plus per-line problems and hints. */
export interface BasketParseResult {
  rows: BasketCsvRow[]
  issues: BasketIssue[]
  warnings: string[]
}

/** Inputs of `allocateBasket`. */
export interface BasketAllocationInput {
  rows: readonly BasketCsvRow[]
  /** Live quotes for the parsed symbols; a missing symbol becomes `no_quote`. */
  quotes: readonly Quote[]
  /** Effective budget in cents: min(user input, available cash). */
  budgetCents: number
  /** Available cash before the basket, used for `cashAfterCents`. */
  cashCents: number
  settings: PaperSettings
}

/** Allocation without the parse/session parts the service adds. */
export interface BasketAllocation {
  budgetCents: number
  rows: BasketPlanRow[]
  warnings: string[]
  totalAmountCents: number
  totalFeesCents: number
  residualCents: number
  cashAfterCents: number
}

/** `90%` — whole percents stay short, fractions keep at most two decimals. */
function percentText(ratio: number): string {
  const percent = Math.round(ratio * 10_000) / 100
  return `${percent.toFixed(2).replace(/\.?0+$/, '')}%`
}

function yuanText(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Parse one weight cell.
 *
 * `0.3` and `30%` are the documented forms; a bare value above 1 is read as a
 * percent (`30` → 30%) and reported, because a user pasting 30 almost never
 * means 3000%. `1` is 100% (a bare `1` is not "above 1").
 */
function parseWeightCell(raw: string): { weight: number; percentShorthand: boolean } | null {
  const text = raw.trim()
  if (text === '') return null
  const withPercent = text.endsWith('%')
  const value = Number(withPercent ? text.slice(0, -1).trim() : text)
  if (!Number.isFinite(value) || value <= 0) return null
  if (withPercent) return { weight: value / 100, percentShorthand: false }
  if (value > 1) return { weight: value / 100, percentShorthand: true }
  return { weight: value, percentShorthand: false }
}

/** `SH600519`, `600519.SH`, `600519.XSHG` or bare `600519` → `600519`. */
function normaliseSymbol(raw: string): string | undefined {
  const bare = raw.trim().toUpperCase()
    .replace(/^(SH|SZ|BJ)(?=\d{6}$)/, '')
    .replace(/\.(SH|SZ|BJ|XSHG|XSHE)$/, '')
  return /^\d{6}$/.test(bare) ? bare : undefined
}

/**
 * A header is only assumed when the first data line has a second column that
 * cannot be a weight; a one-column first line is treated as a bad data row so
 * the user gets a line error instead of silently losing it.
 */
function looksLikeHeader(cells: readonly string[]): boolean {
  if (cells.length < 2) return false
  return parseWeightCell(cells[1]) === null
}

/**
 * Parse the two-column CSV format.
 *
 * Problems never throw: every bad line becomes a `BasketIssue` so the client can
 * show the rest of the file, while a basket over 20 symbols is rejected as a
 * whole (truncating silently would place a basket the user did not ask for).
 */
export function parseBasketCsv(csv: string): BasketParseResult {
  const issues: BasketIssue[] = []
  const warnings: string[] = []
  const merged = new Map<string, number>()
  const lines = csv.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  let firstDataLine = true

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const lineNo = index + 1
    // Blank lines and comments are deliberately silent: a pasted export can
    // carry them without the user having to clean the file first.
    if (line === '' || line.startsWith('#')) continue
    const cells = line.split(',').map(cell => cell.trim())
    if (firstDataLine) {
      firstDataLine = false
      if (looksLikeHeader(cells)) continue
    }

    const symbol = normaliseSymbol(cells[0] ?? '')
    if (symbol === undefined) {
      issues.push({ line: lineNo, message: `证券代码无效：${cells[0] ?? ''}，需要 6 位数字` })
      continue
    }
    const weight = parseWeightCell(cells[1] ?? '')
    if (weight === null) {
      issues.push({ line: lineNo, message: `权重无效：${cells[1] ?? '(空)'}，需要正数或百分比` })
      continue
    }
    if (weight.percentShorthand) {
      warnings.push(`第 ${lineNo} 行权重 ${cells[1]} 按 ${percentText(weight.weight)} 解析`)
    }
    const previous = merged.get(symbol)
    if (previous !== undefined) warnings.push(`重复代码 ${symbol} 权重已合并`)
    merged.set(symbol, (previous ?? 0) + weight.weight)
  }

  if (merged.size > MAX_BASKET_SYMBOLS) {
    return {
      rows: [],
      issues: [...issues, { line: 0, message: `最多支持 ${MAX_BASKET_SYMBOLS} 只，当前 ${merged.size} 只，整份 CSV 已拒绝` }],
      warnings: [],
    }
  }
  if (merged.size === 0) {
    return {
      rows: [],
      issues: [...issues, { line: 0, message: 'CSV 没有可用的数据行' }],
      warnings,
    }
  }

  const total = [...merged.values()].reduce((sum, weight) => sum + weight, 0)
  const rows: BasketCsvRow[] = []
  for (const [symbol, weight] of merged) rows.push({ symbol, weight: weight / total })
  if (Math.abs(total - 1) > WEIGHT_EPSILON) warnings.push(`权重合计 ${percentText(total)}，已按比例归一`)
  return { rows, issues, warnings }
}

/** Plan one row against the effective budget; no cross-row coupling yet. */
function planRow(row: BasketCsvRow, quote: Quote | undefined, budgetCents: number, settings: PaperSettings): BasketPlanRow {
  const targetCents = Math.floor(budgetCents * row.weight)
  const base: BasketPlanRow = {
    symbol: row.symbol,
    name: quote?.name,
    weight: row.weight,
    targetCents,
    qty: 0,
    amountCents: 0,
    feesCents: 0,
    actualWeight: 0,
    status: 'no_quote',
  }
  // A zero last price cannot fill (M2 fills at `last`), so it is "no quote"
  // for allocation purposes even if FTShare returned the symbol.
  if (quote === undefined || !Number.isFinite(quote.last) || quote.last <= 0) return base
  if (quote.status === 'suspended') return { ...base, status: 'suspended' }

  const price = roundPrice(quote.last)
  const perLotCents = amountCents(price, 100)
  if (perLotCents <= 0) return base
  const qty = Math.floor(targetCents / perLotCents) * 100
  if (qty <= 0) {
    return {
      ...base,
      price,
      status: 'zero_lot',
      warning: `一手约 ${yuanText(perLotCents)} 元，目标 ${yuanText(targetCents)} 元`,
    }
  }
  const amount = amountCents(price, qty)
  return {
    ...base,
    price,
    qty,
    amountCents: amount,
    feesCents: computeFees(amount, 'buy', settings).totalCents,
    status: 'ok',
  }
}

function totalCostCents(rows: readonly BasketPlanRow[]): number {
  return rows.reduce((sum, row) => sum + row.amountCents + row.feesCents, 0)
}

/**
 * Fee buy-back.
 *
 * Per-row targets ignore fees, so the sum can overshoot the budget by the total
 * fee. Trim the row that fills its target the most, one lot at a time; a row
 * can be trimmed to zero (cheap stocks have small lots) and is then reported as
 * `zero_lot` rather than pretending a 0-share `ok` row.
 */
function buyBackToBudget(rows: BasketPlanRow[], budgetCents: number, settings: PaperSettings): void {
  let guard = 0
  while (totalCostCents(rows) > budgetCents && guard < 100_000) {
    guard += 1
    let fullest: BasketPlanRow | undefined
    let fullestRatio = Number.NEGATIVE_INFINITY
    for (const row of rows) {
      if (row.qty < 100) continue
      const ratio = row.targetCents > 0 ? row.amountCents / row.targetCents : Number.POSITIVE_INFINITY
      if (ratio > fullestRatio) {
        fullestRatio = ratio
        fullest = row
      }
    }
    if (fullest === undefined) return
    const qty = fullest.qty - 100
    const amount = amountCents(fullest.price ?? 0, qty)
    fullest.qty = qty
    fullest.amountCents = amount
    // A row trimmed to zero lots will not trade: no commission on zero notional.
    fullest.feesCents = qty === 0 ? 0 : computeFees(amount, 'buy', settings).totalCents
    if (qty === 0) {
      fullest.status = 'zero_lot'
      fullest.warning = '为满足整批预算，已减至 0 手'
    }
  }
}

/**
 * Split the budget across the parsed rows.
 *
 * Symbols without a usable quote are dropped from the allocation and their
 * budget stays in cash instead of being re-spread: the user asked for those
 * weights, not for the largest names to be bought with the leftover.
 */
export function allocateBasket(input: BasketAllocationInput): BasketAllocation {
  const budgetCents = Math.max(0, Math.floor(input.budgetCents))
  const quoteMap = new Map(input.quotes.map(quote => [quote.symbol, quote]))
  const rows = input.rows.map(row => planRow(row, quoteMap.get(row.symbol), budgetCents, input.settings))
  buyBackToBudget(rows, budgetCents, input.settings)

  const totalAmountCents = rows.reduce((sum, row) => sum + row.amountCents, 0)
  const totalFeesCents = rows.reduce((sum, row) => sum + row.feesCents, 0)
  for (const row of rows) row.actualWeight = budgetCents > 0 ? row.amountCents / budgetCents : 0

  const warnings: string[] = []
  const zeroLot = rows.filter(row => row.status === 'zero_lot').length
  const excluded = rows.filter(row => row.status === 'no_quote' || row.status === 'suspended').length
  if (zeroLot > 0 || excluded > 0) {
    const parts: string[] = []
    if (zeroLot > 0) parts.push(`${zeroLot} 只不足 1 手`)
    if (excluded > 0) parts.push(`${excluded} 只无行情或停牌，未配`)
    warnings.push(parts.join('；'))
  }

  const residualCents = budgetCents - totalAmountCents - totalFeesCents
  if (residualCents > 0 && budgetCents > 0) {
    const tail = excluded > 0 ? '含未配标的预算与整手取整' : '主要来自整手取整'
    warnings.push(`剩余现金 ${yuanText(residualCents)} 元（${percentText(residualCents / budgetCents)}），${tail}`)
  }

  return {
    budgetCents,
    rows,
    warnings,
    totalAmountCents,
    totalFeesCents,
    residualCents,
    cashAfterCents: input.cashCents - totalAmountCents - totalFeesCents,
  }
}
