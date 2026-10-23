import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSymbol, requireStock, tryParseSymbol } from '../lib/core/symbol.js'

function idOf(input) {
  const parsed = tryParseSymbol(input)
  assert.equal(parsed.ok, true, `${input} should parse: ${parsed.message ?? ''}`)
  return parsed.symbol.id
}

test('symbol: bare codes are resolved through the stock namespace', () => {
  assert.equal(idOf('000001'), '000001.SZ')
  assert.equal(idOf('000002'), '000002.SZ')
  assert.equal(idOf('300750'), '300750.SZ')
  assert.equal(idOf('600519'), '600519.SH')
  assert.equal(idOf('688981'), '688981.SH')
  assert.equal(idOf('430047'), '430047.BJ')
  assert.equal(idOf('920001'), '920001.BJ')
})

test('symbol: the exchange is part of the identity, not a suffix to strip', () => {
  assert.equal(idOf('000001.SZ'), '000001.SZ')
  assert.equal(idOf('000001.SH'), '000001.SH')
  assert.equal(idOf('399001.SZ'), '399001.SZ')
  assert.equal(idOf('510300.SH'), '510300.SH')
  // Prefix forms fold to the same id.
  assert.equal(idOf('sh600519'), '600519.SH')
  assert.equal(idOf('SZ000001'), '000001.SZ')
  assert.equal(idOf('６００５１９'), '600519.SH')
})

test('symbol: an exchange that cannot host the code is rejected, never guessed', () => {
  const wrongMarket = tryParseSymbol('600519.SZ')
  assert.equal(wrongMarket.ok, false)
  assert.equal(wrongMarket.code, 'INVALID_SYMBOL')
  assert.match(wrongMarket.message, /不是深市代码/)

  const malformed = tryParseSymbol('6005')
  assert.equal(malformed.ok, false)
  assert.match(malformed.message, /代码格式/)

  const empty = tryParseSymbol('  ')
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'INVALID_SYMBOL')

  // 920xxx is a Beijing code; it cannot be dressed up as a Shanghai B share.
  const wrongBse = tryParseSymbol('920001.SH')
  assert.equal(wrongBse.ok, false)
  assert.match(wrongBse.message, /不是沪市代码/)
})

test('symbol: only stocks are tradable', () => {
  const index = requireStock('000001.SH')
  assert.equal(index.ok, false)
  assert.equal(index.code, 'UNSUPPORTED_INSTRUMENT')
  assert.match(index.message, /指数/)

  const fund = requireStock('510300.SH')
  assert.equal(fund.ok, false)
  assert.match(fund.message, /基金/)

  const stock = requireStock('000001')
  assert.equal(stock.ok, true)
  assert.equal(stock.symbol.id, '000001.SZ')
})

test('symbol: display always carries code and market', () => {
  assert.equal(formatSymbol('000001.SZ', '平安银行'), '000001.SZ 平安银行')
  assert.equal(formatSymbol('000001.SH', '上证指数'), '000001.SH 上证指数')
  assert.equal(formatSymbol('000001.SZ'), '000001.SZ')
})
