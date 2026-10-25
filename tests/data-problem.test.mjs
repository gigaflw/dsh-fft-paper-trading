import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDataProblem } from '../lib/service/data-source.js'

const AT = '2026-10-26T02:00:00.000Z'

test('data problem: success clears the problem', () => {
  assert.equal(classifyDataProblem({ state: 'ok' }, AT), undefined)
})

test('data problem: auth, plan and quota codes become actionable reasons', () => {
  assert.equal(classifyDataProblem({ state: 'denied', noticeCode: '401', notice: 'API Key 缺失' }, AT).reason, 'invalid-key')
  assert.equal(classifyDataProblem({ state: 'denied', noticeCode: 'route_not_allowed', notice: '套餐未开通' }, AT).reason, 'plan-denied')
  assert.equal(classifyDataProblem({ state: 'failed', noticeCode: '429', notice: 'too many requests' }, AT).reason, 'quota')
  // UPSTREAM_UNAVAILABLE is shared by a real outage and a spent anonymous
  // quota; only the bundle's sentinel tells them apart.
  assert.equal(
    classifyDataProblem({ state: 'failed', noticeCode: 'UPSTREAM_UNAVAILABLE', notice: '最近 1 天最多访问 500 次。免费配额用尽，配置 FTShare API Key 或稍后重试。' }, AT).reason,
    'quota',
  )
  assert.equal(classifyDataProblem({ state: 'failed', noticeCode: 'UPSTREAM_UNAVAILABLE', notice: '网关 502' }, AT).reason, 'upstream')
})

test('data problem: network codes and unknown failures stay readable', () => {
  assert.equal(classifyDataProblem({ state: 'failed', noticeCode: 'timeout', notice: '连接超时' }, AT).reason, 'network')
  const unknown = classifyDataProblem({ state: 'failed', notice: 'x'.repeat(400) }, AT)
  assert.equal(unknown.reason, 'upstream')
  assert.ok(unknown.message.length <= 161, 'the stored cause is trimmed')
  assert.equal(unknown.at, AT)
})
