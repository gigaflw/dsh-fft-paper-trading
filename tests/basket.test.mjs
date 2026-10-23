import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../lib/contract.js'
import { MAX_BASKET_SYMBOLS, allocateBasket, parseBasketCsv } from '../lib/core/basket.js'

function quote(symbol, last, extra = {}) {
  return { symbol, name: symbol, last, marketTs: '2026-10-19T02:00:00.000Z', fetchedAt: '2026-10-19T02:00:00.000Z', ...extra }
}

function allocate(rows, quotes, budgetCents, cashCents = budgetCents) {
  return allocateBasket({ rows, quotes, budgetCents, cashCents, settings: DEFAULT_SETTINGS })
}

function rowOf(plan, symbol) {
  const row = plan.rows.find(item => item.symbol === symbol)
  assert.ok(row, `expected a row for ${symbol}`)
  return row
}

test('basket parse: header, weight forms and symbol suffixes', () => {
  const parsed = parseBasketCsv('代码,权重\n600519.SH,30%\n000001.SZ,0.2\n300750.SZ,50')
  assert.deepEqual(parsed.issues, [])
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['600519.SH', '000001.SZ', '300750.SZ'])
  assert.equal(parsed.rows[0].weight, 0.3)
  assert.equal(parsed.rows[1].weight, 0.2)
  assert.equal(parsed.rows[2].weight, 0.5)
  // A bare 50 is read as a percent and must say so.
  assert.ok(parsed.warnings.some(warning => /第 4 行权重 50 按 50% 解析/.test(warning)), parsed.warnings.join('；'))
  // Weights already total 100%: no normalisation hint.
  assert.ok(!parsed.warnings.some(warning => /归一/.test(warning)))
})

test('basket parse: no header, BOM, comments, blank lines and extra columns', () => {
  const parsed = parseBasketCsv('\uFEFF# 我的组合\r\n\r\n600519.SH,30%,忽略这一列\r\n000001.SZ,70%')
  assert.deepEqual(parsed.issues, [])
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].weight, 0.3)
  assert.equal(parsed.rows[1].weight, 0.7)
  assert.deepEqual(parsed.warnings, [])
})

test('basket parse: duplicate symbols merge and say so', () => {
  const parsed = parseBasketCsv('600519.SH,30%\n600519.SH,20%\n000001.SZ,50%')
  assert.equal(parsed.rows.length, 2)
  assert.equal(rowOf(parsed, '600519.SH').weight, 0.5)
  assert.ok(parsed.warnings.some(warning => /重复代码 600519.SH/.test(warning)), parsed.warnings.join('；'))
})

test('basket parse: off-100% weights normalise with a hint', () => {
  const parsed = parseBasketCsv('600519.SH,20%\n000001.SZ,20%\n300750.SZ,50%')
  assert.deepEqual(parsed.issues, [])
  const total = parsed.rows.reduce((sum, row) => sum + row.weight, 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
  assert.ok(Math.abs(rowOf(parsed, '600519.SH').weight - 2 / 9) < 1e-9)
  assert.ok(parsed.warnings.some(warning => /权重合计 90%，已按比例归一/.test(warning)), parsed.warnings.join('；'))
})

test('basket parse: invalid lines report their line and keep the other rows', () => {
  const parsed = parseBasketCsv('代码,权重\n6005,50%\n600519.SH,0\n000001.SZ,30%\nnot-a-number,10%')
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['000001.SZ'])
  assert.deepEqual(parsed.issues.map(issue => issue.line), [2, 3, 5])
  assert.ok(parsed.issues.every(issue => issue.message !== ''))
  // Only row 4 survived and it was normalised to 100%.
  assert.equal(parsed.rows[0].weight, 1)
  assert.ok(parsed.warnings.some(warning => /归一/.test(warning)))
})

test('basket parse: weight 1 means 100%', () => {
  const parsed = parseBasketCsv('600519.SH,1')
  assert.deepEqual(parsed.issues, [])
  assert.equal(parsed.rows[0].weight, 1)
  assert.deepEqual(parsed.warnings, [])
})

test('basket parse: an empty file is an issue, not an exception', () => {
  const parsed = parseBasketCsv('')
  assert.deepEqual(parsed.rows, [])
  assert.equal(parsed.issues.length, 1)
  assert.equal(parsed.issues[0].line, 0)
  assert.match(parsed.issues[0].message, /没有可用的数据行/)

  const headerOnly = parseBasketCsv('代码,权重')
  assert.deepEqual(headerOnly.rows, [])
  assert.equal(headerOnly.issues[0].line, 0)
})

test('basket parse: more than 20 symbols rejects the whole file', () => {
  const lines = []
  for (let index = 1; index <= MAX_BASKET_SYMBOLS + 1; index += 1) lines.push(`${String(600000 + index)},1`)
  const parsed = parseBasketCsv(lines.join('\n'))
  assert.deepEqual(parsed.rows, [], 'the file must not be silently truncated')
  assert.equal(parsed.issues.length, 1)
  assert.equal(parsed.issues[0].line, 0)
  assert.match(parsed.issues[0].message, /整份 CSV 已拒绝/)
})

test('basket parse: a one-column first line is a data error, not a header', () => {
  const parsed = parseBasketCsv('600519.SH\n000001.SZ,50%')
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['000001.SZ'])
  assert.deepEqual(parsed.issues.map(issue => issue.line), [1])
})

test('basket allocate: 100k with one unaffordable lot', () => {
  const parsed = parseBasketCsv('600519.SH,25%\n000001.SZ,25%\n300750.SZ,25%\n600000.SH,25%')
  const plan = allocate(parsed.rows, [
    quote('600519.SH', 300), // 30,000 yuan per lot > 25,000 target
    quote('000001.SZ', 10),
    quote('300750.SZ', 20),
    quote('600000.SH', 5),
  ], 10_000_000)

  const high = rowOf(plan, '600519.SH')
  assert.equal(high.status, 'zero_lot')
  assert.equal(high.qty, 0)
  assert.match(high.warning, /一手约 30000\.00 元，目标 25000\.00 元/)

  assert.equal(rowOf(plan, '000001.SZ').qty, 2_500)
  assert.equal(rowOf(plan, '000001.SZ').amountCents, 2_500_000)
  assert.equal(rowOf(plan, '300750.SZ').qty, 1_200)
  assert.equal(rowOf(plan, '600000.SH').qty, 5_000)
  assert.equal(plan.totalAmountCents, 7_400_000)
  assert.equal(plan.residualCents, 10_000_000 - plan.totalAmountCents - plan.totalFeesCents)
  assert.ok(plan.warnings.some(warning => /1 只不足 1 手/.test(warning)), plan.warnings.join('；'))
  assert.ok(!plan.warnings.some(warning => /无行情或停牌/.test(warning)))
})

test('basket allocate: 1M spends nearly the whole budget in lots', () => {
  const parsed = parseBasketCsv('600519.SH,25%\n000001.SZ,25%\n300750.SZ,25%\n600000.SH,25%')
  const plan = allocate(parsed.rows, [
    quote('600519.SH', 300),
    quote('000001.SZ', 10),
    quote('300750.SZ', 20),
    quote('600000.SH', 5),
  ], 100_000_000)

  assert.ok(plan.rows.every(row => row.status === 'ok'))
  assert.ok(plan.rows.every(row => row.qty % 100 === 0))
  // 8 lots of a 30k lot cannot fill the 250k target exactly; the rest is cash.
  assert.equal(rowOf(plan, '600519.SH').qty, 800)
  assert.equal(plan.totalAmountCents, 99_000_000)
  assert.ok(plan.totalAmountCents + plan.totalFeesCents <= 100_000_000)
  assert.equal(plan.residualCents, 100_000_000 - plan.totalAmountCents - plan.totalFeesCents)
})

test('basket allocate: fees are bought back so the batch fits the budget', () => {
  const parsed = parseBasketCsv('600519.SH,30%\n000001.SZ,30%\n300750.SZ,40%')
  // Without the buy-back the three full targets plus the minimum commissions
  // cost 101,500 cents against a 100,000 budget.
  const plan = allocate(parsed.rows, [quote('600519.SH', 1), quote('000001.SZ', 1), quote('300750.SZ', 1)], 100_000)
  const cost = plan.totalAmountCents + plan.totalFeesCents
  assert.ok(cost <= 100_000, `batch cost ${cost} must fit the 100,000 budget`)
  assert.ok(plan.rows.every(row => row.qty % 100 === 0))
  assert.equal(plan.totalFeesCents, 1_500, 'each row still pays the minimum commission')
  // The fullest row loses one lot, and the leftovers stay in cash.
  assert.deepEqual(plan.rows.map(row => row.qty), [200, 300, 400])
  assert.equal(plan.totalAmountCents, 90_000)
  assert.equal(plan.residualCents, 100_000 - cost)
})

test('basket allocate: no-quote and suspended rows keep their budget in cash', () => {
  const parsed = parseBasketCsv('000001.SZ,50%\n600519.SH,25%\n300750.SZ,25%')
  const plan = allocate(parsed.rows, [
    quote('000001.SZ', 10),
    // 600519.SH is missing entirely; 300750.SZ is suspended with a live price.
    quote('300750.SZ', 10, { status: 'suspended' }),
  ], 10_000_000)

  assert.equal(rowOf(plan, '600519.SH').status, 'no_quote')
  assert.equal(rowOf(plan, '600519.SH').qty, 0)
  assert.equal(rowOf(plan, '300750.SZ').status, 'suspended')
  assert.equal(rowOf(plan, '300750.SZ').qty, 0)
  // The excluded halves are not re-spread onto the surviving row.
  const ok = rowOf(plan, '000001.SZ')
  assert.equal(ok.amountCents, 5_000_000)
  assert.equal(ok.actualWeight, 0.5)
  assert.equal(plan.totalAmountCents, 5_000_000)
  assert.ok(plan.warnings.some(warning => /2 只无行情或停牌，未配/.test(warning)), plan.warnings.join('；'))
  assert.ok(plan.warnings.some(warning => /含未配标的预算/.test(warning)))
  const actualSum = plan.rows.reduce((sum, row) => sum + row.actualWeight, 0)
  assert.ok(actualSum <= 1)
})

test('basket allocate: zero budget allocates nothing and does not go negative', () => {
  const parsed = parseBasketCsv('600519.SH,100%')
  const plan = allocate(parsed.rows, [quote('600519.SH', 10)], 0)
  assert.equal(plan.rows[0].status, 'zero_lot')
  assert.equal(plan.rows[0].qty, 0)
  assert.equal(plan.totalAmountCents, 0)
  assert.equal(plan.residualCents, 0)
  assert.equal(plan.cashAfterCents, 0)
})

test('basket allocate: cashAfterCents follows the batch cost', () => {
  const parsed = parseBasketCsv('600519.SH,100%')
  const plan = allocate(parsed.rows, [quote('600519.SH', 10)], 5_000_000, 8_000_000)
  assert.equal(plan.rows[0].qty, 4900)
  assert.equal(plan.cashAfterCents, 8_000_000 - plan.totalAmountCents - plan.totalFeesCents)
  assert.equal(plan.residualCents, 5_000_000 - plan.totalAmountCents - plan.totalFeesCents)
})

test('basket allocate: a row trimmed to zero lots carries no fees', () => {
  const plan = allocate(
    [{ symbol: '600519.SH', weight: 0.5 }, { symbol: '000001.SZ', weight: 0.5 }],
    [quote('600519.SH', 10), quote('000001.SZ', 10)],
    200_100,
  )
  const zero = plan.rows.find(row => row.status === 'zero_lot')
  assert.ok(zero, JSON.stringify(plan.rows))
  assert.equal(zero.qty, 0)
  assert.equal(zero.amountCents, 0)
  assert.equal(zero.feesCents, 0, 'zero-lot rows must not pay the minimum commission')
  assert.equal(plan.totalFeesCents, plan.rows.reduce((sum, row) => sum + row.feesCents, 0))
  assert.equal(plan.residualCents, plan.budgetCents - plan.totalAmountCents - plan.totalFeesCents)
})


test('basket: accepts exchange prefixes like SH600519', () => {
  const parsed = parseBasketCsv('SH600519,50%\nSZ000001,50%')
  assert.equal(parsed.issues.length, 0)
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['600519.SH', '000001.SZ'])
})


test('basket: accepts quoted cells from an Excel export', () => {
  const parsed = parseBasketCsv('"代码","权重"\n"SH600519","30%"\n"000001.SZ","70%"')
  assert.equal(parsed.issues.length, 0)
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['600519.SH', '000001.SZ'])
})


test('basket: accepts full-width digits and percent from an IME', () => {
  const parsed = parseBasketCsv('６００５１９,３０％\n000001.SZ,70%')
  assert.equal(parsed.issues.length, 0)
  assert.deepEqual(parsed.rows.map(row => row.symbol), ['600519.SH', '000001.SZ'])
  assert.ok(Math.abs(parsed.rows[0].weight - 0.3) < 1e-9)
})
