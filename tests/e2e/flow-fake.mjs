#!/usr/bin/env node
/**
 * 全链路复跑：假时钟 + 假行情，把用户故事 9 步走一遍并断言关键数字。
 *
 *   node tests/e2e/flow-fake.mjs
 *
 * 前置：应用带 --remote-debugging-port=9023 启动；`lib/` 已构建（pnpm build）。
 * 副作用：会接管面板（切 tab、下单），结束时恢复 window.fetch 并刷新回真实后端；
 *        账本写在 tmp/e2e-home，不碰 ~/.dsh/paper-trading。
 */
import { startFakeBackend } from './fake-backend.mjs'
import { connect } from './cdp.mjs'

const PORT = Number(process.env.PT_FAKE_PORT ?? 4599)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const failures = []
/** 还原页面 fetch；只认第一次抓到的原生实现，绝不拿包装器当原生。 */
const RESTORE_FETCH = `(() => {
  const entry = window.__e2e;
  if (!entry || typeof entry.nativeFetch !== 'function') return 'no-native-fetch';
  window.fetch = entry.nativeFetch;
  entry.fetchPatched = false;
  return window.fetch.__e2eWrapper === true ? 'still-wrapped' : 'restored';
})()`
const assert = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  ← ${detail}` : ''}`)
  if (!ok) failures.push(name)
}
async function waitFor(label, fn, { timeout = 20000, interval = 300 } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  throw new Error(`等待超时：${label}（最后结果 ${JSON.stringify(last)}）`)
}

const backend = await startFakeBackend({ port: PORT })
let page
page = await connect()

// Ctrl-C / kill 也要还原 fetch，否则整个桌面端的请求都会被残留包装器接管。
const shutdown = async code => {
  try { await page?.evaluate(RESTORE_FETCH) } catch {}
  try { await page?.clickText('刷新') } catch {}
  process.exit(code)
}
process.once('SIGINT', () => { void shutdown(130) })
process.once('SIGTERM', () => { void shutdown(143) })

// 先确认面板的 RPC 真的落到假后端（否则后面所有断言都会对着真实账本跑）。
const probe = await page.evaluate(`(async () => {
  const r = await fetch('/api/ft-paper-trading', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'account/get', payload: {} }),
  }).then(r => r.json());
  return JSON.stringify({ ok: r.ok, tradeDate: r.value?.tradeDate, cash: r.value?.cash });
})()`)
console.log(`backend: ${probe}`)

const panel = () => page.text('.pt-root')
/** 切 tab 并等到它真的变成 active，否则后续断言会读到上一页的残留文本。 */
const tab = async prefix => {
  const found = await page.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.pt-tab')].find(t => t.textContent.trim().startsWith(${JSON.stringify(prefix)}));
    if (!hit) return false;
    window.__e2e.click(hit);
    return true;
  })()`)
  if (!found) throw new Error(`没有「${prefix}」页签`)
  await waitFor(`切到${prefix}页`, () => page.evaluate(`(() => {
    const active = [...document.querySelectorAll('.pt-tab')].find(t => t.dataset.active === 'true');
    return Boolean(active && active.textContent.trim().startsWith(${JSON.stringify(prefix)}));
  })()`), { timeout: 5000 })
}
const clickText = async text => {
  const hits = await page.clickText(text)
  if (hits === 0) throw new Error(`找不到可点的「${text}」`)
  return hits
}
const receiptText = () => page.evaluate(`[...document.querySelectorAll('.pt-receipt')].map(x => x.innerText).join(' | ')`)
const submit = async () => {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.pt-card button')].find(b => b.className.includes('primary'));
    if (!button) return 'missing';
    if (button.disabled) return 'disabled:' + (button.title || '');
    window.__e2e.click(button);
    return 'clicked';
  })()`)
  if (clicked !== 'clicked') throw new Error(`提交按钮不可用（${clicked}）`)
}
/** 假后端每轮都是同样的单号，回报文本可重复；用「账本状态」证明这一单生效。 */
const submitAndExpect = async (label, expected, after) => {
  await submit()
  await waitFor(label, async () => {
    const receipt = await receiptText()
    const text = (await panel()) ?? ''
    return receipt.includes(expected) && text.includes(after) ? text : null
  })
}

/** 侧栏入口只认 BUTTON（同名 span 可能是别的会话标题）。 */
const openPanel = () => page.evaluate(`(() => {
  if (document.querySelector('.pt-root')) return true;
  const entry = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '模拟交易');
  if (!entry) return false;
  window.__e2e.click(entry);
  return 'clicked';
})()`)

try {
  if (!(await page.panelOpen())) {
    // 连点两次：用户可能正好在切会话，第一次会落空。
    await openPanel()
    await page.sleep(1200)
    if (!(await page.panelOpen())) await openPanel()
    await waitFor('面板打开', () => page.panelOpen(), { timeout: 15000 })
  }
  // 面板可能还停在真实后端的数据上：接上假后端后强制刷新一次，
  // 否则按钮会按真实的「已收盘」禁用，提交变成空操作。
  // 原生 fetch 只抓第一次；若上次运行被 Ctrl-C 打断留下包装器，绝不能把它当原生（会自我递归）。
  await page.evaluate(`(() => {
    const w = window;
    w.__e2e = w.__e2e || {};
    const entry = w.__e2e;
    if (!entry.nativeFetch) {
      if (w.fetch.__e2eWrapper === true) {
        throw new Error('window.fetch 已被残留包装器接管，请先 ⌘Q 重开应用');
      }
      entry.nativeFetch = w.fetch.bind(w);
    }
    const nativeFetch = entry.nativeFetch;
    const patched = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/ft-paper-trading')) {
        return nativeFetch('http://127.0.0.1:${PORT}/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: init.body,
        });
      }
      return nativeFetch(input, init);
    };
    patched.__e2eWrapper = true;
    entry.fetchPatched = true;
    w.fetch = patched;
    return true;
  })()`)
  await clickText('刷新')
  await waitFor('切到假后端', async () => {
    const t = await panel()
    return t !== null && t.includes('上午连续竞价') ? t : null
  })

  await tab('交易')
  // 票面状态会跨会话保留：先把方向/类型/数量钉回买入市价 100 股。
  await clickText('买入')
  await clickText('市价')
  await page.inputAt(1, '100')

  // 1–3：行情随输入出现，费用即时算
  await page.inputAt(0, '000001')
  // 一次等到「行情 + 金额 + 现金影响」都换成本单的数字，避免读到上一轮的预览
  let text = await waitFor('实时预览', async () => {
    const t = await panel()
    return t !== null && t.includes('预估成交价') && t.includes('1130.00') && t.includes('98864.99') ? t : null
  })
  assert('输入即出行情/预览', text.includes('现价 11.30') && text.includes('预估成交价'))
  assert('费用即时可用', text.includes('1130.00') && text.includes('98864.99'))

  // 4：市价买入 → 立即全成，成交价=最新价
  await submitAndExpect('成交回报', '成交：买入', '持仓 1')
  text = await panel()
  assert('市价单立即成交', text.includes('成交：买入 000001.SZ 平安银行 100 股'))
  assert('成交价无滑点', text.includes('价 11.30'))
  assert('成交后现金', text.includes('98864.99'))

  // 5：持仓与 T+1
  await tab('持仓')
  await waitFor('持仓出现', async () => (await panel())?.includes('平安银行'))
  text = await panel()
  assert('持仓数量/可卖', /\b100\s*\t?0\b|100\t0/.test(text) || (text.includes('100') && text.includes('0')), text.slice(0, 200))
  assert('持仓成本含费用', text.includes('11.35'))

  // 6：行情变动 → 自动刷新浮动盈亏（窗口被遮挡时 5 秒轮询会停，脚本兜底点一次刷新）
  backend.setQuote('000001', 11.6)
  const auto = await waitFor('浮动盈亏刷新', async () => (await panel())?.includes('+24.99'), { timeout: 9000 }).catch(() => null)
  if (auto === null) {
    console.log('NOTE  自动刷新未在 9 秒内出现（窗口可能不可见），改为手动刷新')
    await clickText('刷新')
    await waitFor('刷新后的浮盈', async () => (await panel())?.includes('+24.99'))
  }
  assert('浮动盈亏跟随最新价', (await panel()).includes('100024.99'))

  // 7：隔夜到下一交易日，T+1 解锁、今日盈亏按昨收算
  backend.setClock('2026-10-23T09:31:00+08:00')
  await clickText('刷新')
  await waitFor('换日', async () => (await panel())?.includes('2026-10-23'))
  text = await panel()
  assert('隔夜开盘', text.includes('上午连续竞价'))
  assert('今日盈亏按昨收（日K收盘 11.20）', text.includes('+40.00'))

  // 8：卖出（T+1 后可卖），平掉回合
  await clickText('卖出')
  await waitFor('切到卖出票面', async () => (await panel())?.includes('预估成交价'))
  await submitAndExpect('卖出成交', '成交：卖出', '持仓 0')
  assert('卖出成交价', (await panel()).includes('价 11.60'))

  // 9：复盘（成交、回合、日终）
  await tab('复盘')
  await waitFor('复盘数据', async () => (await panel())?.includes('回合统计'))
  text = await panel()
  assert('已实现盈亏', text.includes('+19.40'))
  assert('回合统计', text.includes('000001') && text.includes('持有天数'))
  assert('日终报告（日K收盘）', text.includes('2026-10-22') && text.includes('日K收盘'))

  // 限价挂单：未穿越先挂，报价下来后由 5 秒撮合自动成交
  await tab('交易')
  await clickText('买入')
  await clickText('限价')
  await page.inputAt(1, '100')
  await page.inputAt(2, '11.40')
  await waitFor('限价预览提示', async () => (await panel())?.includes('未到限价'))
  await submitAndExpect('挂单回报', '挂单：买入', '订单 1')
  backend.setQuote('000001', 11.35)
  await backend.tick()   // 面板自己的 5 秒心跳在窗口不可见时不会跑，这里补一拍
  await waitFor('挂单成交', async () => {
    const t = await panel()
    return t !== null && t.includes('持仓 1') ? t : null
  }, { timeout: 9000 }).catch(async () => { await clickText('刷新') })
  await waitFor('成交后持仓', async () => (await panel())?.includes('持仓 1'))
  assert('挂单穿越后成交', (await panel()).includes('持仓 1'))

  // 撤单
  await clickText('限价')
  await page.inputAt(2, '11.20')
  await waitFor('可提交', async () => {
    const t = await panel()
    return t.includes('11.20') && !t.includes('不可提交')
  })
  await submit()
  await tab('订单')
  await waitFor('挂单行出现', async () => (await panel())?.includes('撤单'))
  await clickText('撤单')
  await waitFor('撤单完成', async () => (await panel())?.includes('手动撤单'))
  assert('撤单原因中文化', (await panel()).includes('已撤'))

  // 收盘 → 次日日终
  backend.setClock('2026-10-23T15:05:00+08:00')
  await tab('复盘')
  const dayEnd = await waitFor('第二天的日终', async () => {
    const t = await panel()
    return t !== null && t.includes('2026-10-23') && t.includes('最后报价') ? t : null
  }).catch(async () => { await clickText('刷新'); return null })
  assert('日终报告跨日', (dayEnd ?? await panel()).includes('最后报价'))

  // 隔夜跳空
  backend.setQuote('000001', 11.5)
  backend.setClock('2026-10-26T09:31:00+08:00')
  await tab('交易')
  await clickText('刷新')
  await waitFor('隔夜反馈', async () => (await panel())?.includes('2026-10-26'))
  text = await panel()
  assert('隔夜今日盈亏', text.includes('+15.00'))
  assert('隔夜可卖解锁', (await panel()).includes('持仓 1'))
} catch (error) {
  console.error(`ERROR ${error.message}`)
  const state = await page.evaluate('JSON.stringify({ title: document.title, root: !!document.querySelector(\'.pt-root\') })').catch(() => '{}')
  const text = await panel().catch(() => null)
  console.error(`STATE ${state}`)
  console.error(`PANEL ${text === null ? '(closed)' : text.slice(0, 400).replace(/\n/g, ' | ')}`)
  failures.push(error.message)
} finally {
  // 还原面板，不 reload（reload 会撞上半写的 link 包，见 README「坑」）。
  const restored = await page.evaluate(RESTORE_FETCH).catch(error => `restore-failed: ${error.message}`)
  if (restored !== 'restored') console.error(`WARN 页面 fetch 未还原干净：${restored}`)
  await page.clickText('刷新').catch(() => {})
  await sleep(500)
  page.close()
  await backend.stop()
}

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(' / ')}`)
process.exit(failures.length === 0 ? 0 : 1)
