#!/usr/bin/env node
/**
 * CDP 驱动原语：附着运行中的 DSH 桌面版（--remote-debugging-port=9023），
 * 在页面里读文本、按文本点按钮、往输入框里写值、执行表达式。
 *
 * 库：
 *   import { connect } from './cdp.mjs'
 *   const page = await connect()
 *   await page.text('.pt-root') / page.clickText('行情') / page.input('.pt-root input', '000001')
 *
 * CLI：
 *   node tests/e2e/cdp.mjs summary
 *   node tests/e2e/cdp.mjs text [selector]
 *   node tests/e2e/cdp.mjs click <文本>
 *   node tests/e2e/cdp.mjs input <selector> <值>
 *   node tests/e2e/cdp.mjs eval '<js>' | eval @file.js | eval -   （- 读 stdin）
 *   node tests/e2e/cdp.mjs watch <秒>     每秒打印面板是否存在与 tab 文本
 *
 * 环境：DSH_CDP_PORT（默认 9023）；PT_CONFIRM=1 时自动接受 window.confirm
 * （面板「重置」用的是原生 confirm，CDP 可以代按，见 README）。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HELPERS = `
window.__e2e = window.__e2e || {};
window.__e2e.visible = el => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
};
/** 可见、文本完全相等的元素；BUTTON/A 允许带子节点，其它只认叶子。 */
window.__e2e.byText = text => [...document.querySelectorAll('button,a,[role=tab],[role=button],td,th,label,span,div')]
  .filter(el => (el.children.length === 0 || ['BUTTON', 'A'].includes(el.tagName)))
  .filter(el => (el.textContent || '').trim() === text && window.__e2e.visible(el));
window.__e2e.click = el => {
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};
/** React 受控输入必须走原生 setter，否则 onChange 不触发。 */
window.__e2e.setInput = (input, value) => {
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
true
`

export async function connect({ port = process.env.DSH_CDP_PORT ?? 9023, target = 0 } = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const pages = targets.filter(t => t.type === 'page' && /^dsh-app:/.test(t.url ?? ''))
  const page = pages[target]
  if (!page) throw new Error(`9023 上没有 DSH page target（现有：${targets.map(t => `${t.type}:${t.title}`).join(', ')}）`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })

  let seq = 0
  const pending = new Map()
  const dialogs = []
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push(msg.params.message)
      if (process.env.PT_CONFIRM === '1') {
        ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
      }
      return
    }
    const entry = pending.get(msg.id)
    if (entry) { pending.delete(msg.id); entry(msg) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, msg => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result))
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
    return r.result.value
  }

  await send('Page.enable').catch(() => {})
  await evaluate(HELPERS)

  return {
    evaluate,
    close: () => ws.close(),
    dialogs,
    /** 面板文本（保留换行，便于断言）。 */
    text: selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`),
    /** 按文本点第一个可见匹配；返回点了几个。 */
    clickText: async text => evaluate(`(() => {
      const hits = window.__e2e.byText(${JSON.stringify(text)});
      if (hits.length === 0) return 0;
      window.__e2e.click(hits[0]);
      return hits.length;
    })()`),
    input: (selector, value) => evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      window.__e2e.setInput(el, ${JSON.stringify(value)});
      return true;
    })()`),
    /** 面板内部的输入框按序号取（代码/数量/限价/备注 的顺序随类型变化，使用前先读）。 */
    inputAt: (index, value) => evaluate(`(() => {
      const el = [...document.querySelectorAll('.pt-root input')][${index}];
      if (!el) return false;
      window.__e2e.setInput(el, ${JSON.stringify(value)});
      return el.value;
    })()`),
    panelOpen: () => evaluate(`!!document.querySelector('.pt-root')`),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2)
  const page = await connect()
  const run = async () => {
    switch (cmd) {
      case 'summary':
        return page.evaluate(`JSON.stringify({
          title: document.title,
          panel: !!document.querySelector('.pt-root'),
          buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 24),
        })`)
      case 'text':
        return page.text(args[0] ?? '.pt-root')
      case 'click': {
        const hits = await page.clickText(args[0])
        return hits === 0 ? `MISS: ${args[0]}` : `OK: ${hits}`
      }
      case 'input':
        return String(await page.input(args[0], args[1]))
      case 'eval': {
        const arg = args[0]
        const source = arg === '-' ? readFileSync(0, 'utf8')
          : arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg
        return JSON.stringify(await page.evaluate(source), null, 2)
      }
      case 'watch': {
        const seconds = Number(args[0] ?? 30)
        for (let i = 0; i < seconds; i += 1) {
          const state = await page.evaluate(`JSON.stringify({
            root: !!document.querySelector('.pt-root'),
            tabs: [...document.querySelectorAll('.pt-tab')].map(t => t.textContent),
          })`)
          console.log(new Date().toISOString().slice(11, 19), state)
          await page.sleep(1000)
        }
        return 'done'
      }
      default:
        return 'commands: summary | text | click | input | eval | watch'
    }
  }
  try {
    console.log(await run())
  } finally {
    page.close()
  }
}
