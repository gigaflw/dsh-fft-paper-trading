import test from 'node:test'
import assert from 'node:assert/strict'
import { probeDataSource } from '../lib/service/data-source.js'

function settingsWith(description) {
  return { apiKey: { async describe() { return description } } }
}

test('data source: no FTShare service means no data source', async () => {
  const status = await probeDataSource({ dataService: false, settings: settingsWith({ configured: false }) })
  assert.deepEqual(status, { state: 'none' })
})

test('data source: a settings handle that cannot be read is invalid, not free', async () => {
  assert.equal((await probeDataSource({ dataService: true })).state, 'invalid')
  assert.match((await probeDataSource({ dataService: true })).message, /无法读取/)
  const throwing = { apiKey: { async describe() { throw new Error('boom') } } }
  assert.equal((await probeDataSource({ dataService: true, settings: throwing })).state, 'invalid')
})

test('data source: no key is the free tier', async () => {
  const status = await probeDataSource({
    dataService: true,
    settings: settingsWith({ configured: false, validation: { status: 'not_tested', apiKey: { status: 'not_run', message: '尚未测试' } } }),
  })
  assert.deepEqual(status, { state: 'free' })
})

test('data source: a configured key stays configured unless the key itself failed', async () => {
  const ok = await probeDataSource({
    dataService: true,
    settings: settingsWith({ configured: true, validation: { status: 'passed', apiKey: { status: 'available', message: '正常' } } }),
  })
  assert.deepEqual(ok, { state: 'configured' })

  const untested = await probeDataSource({
    dataService: true,
    settings: settingsWith({ configured: true, validation: { status: 'not_tested', apiKey: { status: 'not_run', message: '尚未测试' } } }),
  })
  assert.deepEqual(untested, { state: 'configured' })

  // A plan/quota limit is not an invalid key: keep the state, carry the reason.
  const limited = await probeDataSource({
    dataService: true,
    settings: settingsWith({ configured: true, validation: { status: 'partial', apiKey: { status: 'permission_denied', message: '套餐未开通' } } }),
  })
  assert.equal(limited.state, 'configured')
  assert.match(limited.message, /套餐未开通/)

  const invalid = await probeDataSource({
    dataService: true,
    settings: settingsWith({ configured: true, validation: { status: 'partial', apiKey: { status: 'auth_failed', message: 'Key 未通过认证' } } }),
  })
  assert.equal(invalid.state, 'invalid')
  assert.match(invalid.message, /未通过认证/)
})
