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

test('data problem: one shared sentence per actionable reason', async () => {
  const { friendlyDataNotice } = await import('../lib/service/data-source.js')
  const at = AT
  assert.equal(friendlyDataNotice({ state: 'denied', noticeCode: '401' }, '行情暂不可用', at), '行情需要 API Key（「设置」中配置后重试）')
  assert.equal(friendlyDataNotice({ state: 'denied', noticeCode: 'route_not_allowed' }, '行情暂不可用', at), '当前 FTShare 套餐未开通该行情接口')
  assert.equal(friendlyDataNotice({ state: 'failed', noticeCode: '429' }, '行情暂不可用', at), '免费行情额度已用尽，配置 API Key 或稍后重试')
  assert.equal(friendlyDataNotice({ state: 'failed', noticeCode: 'timeout' }, '行情暂不可用', at), '行情服务暂时不可用，请稍后重试')
  // Unknown causes may pass through a short notice, never adapter internals.
  assert.equal(friendlyDataNotice({ state: 'failed', notice: '行情服务未就绪' }, '行情暂不可用', at), '行情服务未就绪')
  assert.equal(friendlyDataNotice({ state: 'failed', notice: 'FTShare ft_v1_x 调用失败' }, '行情暂不可用', at), '行情暂不可用')
})
