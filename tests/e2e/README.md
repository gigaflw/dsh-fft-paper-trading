# tests/e2e —— 模拟盘的三条测试路径

这里记录的是 2026-10-22 那轮排查/回归实际用过的方法，不新增用例。三条路径互补：离线断言查账本与撮合，
假数据全链路查面板与撮合联动，CDP 走查查真实行情下的手感。

```
tests/e2e/
  cdp.mjs                # 驱动原语（连 9023，读/点/写）
  fake-backend.mjs       # 假时钟 + 假行情的 RPC 后端（隔离 home）
  flow-fake.mjs          # 用假后端把用户故事 9 步跑一遍并断言
  offline-ledger.mjs     # 账本：重复 seq / 旧 settings / NaN 锁户 / 重置 / 导出
  offline-matching.mjs   # 撮合：最新价全成 / 挂单 / 无 TTL / 旧账本迁移
  offline-basket.mjs     # 一揽子：预览/整批下单/幂等/收盘拒绝（真服务+真账本）
  ui-panel.mjs           # 面板 UI：真 React DOM + 真 bundle + 假 RPC（不启 DSH）
  ui-fake.js             # ui-panel 的假后端与点击剧本
```

## 0. 前置

- 应用带调试口启动：`/Applications/DeepSeek\ Harness.app/Contents/MacOS/DeepSeek\ Harness --remote-debugging-port=9023`
  （调试口是启动参数，事后补不了）。
- `pnpm build` 过一次（离线断言与假后端都直接用 `lib/`）。
- 面板从侧栏「模拟交易」进；装载失败时先 ⌘Q 重开再试。

## 1. 离线断言（最快，返回码即结论）

```bash
node tests/e2e/offline-ledger.mjs      # 0 = 全过
node tests/e2e/offline-matching.mjs
```

不需要应用、不碰 `~/.dsh`，数据写在 `tmp/`。适合改完账本/撮合逻辑先跑一遍，再看 UI。

## 2. 假数据全链路（可复跑，会接管面板）

```bash
node tests/e2e/flow-fake.mjs           # 0 = 全过；失败会打印第一处不满足的文本
```

做法：
1. `fake-backend.mjs` 用隔离 `tmp/e2e-home` 起一个真 `PaperService`，时钟、行情都由本进程控制；
2. 页面里把 `window.fetch` 对 `/api/ft-paper-trading` 的请求转发到 `127.0.0.1:4599/rpc`（宿主注册的
   route 不在网络栈上，CDP 的 Fetch domain 拦不到，所以只能改页面里的 fetch）；
3. 脚本按剧本推进：设代码 → 断言实时预览 → 市价买入 → 持仓/T+1 → 改报价看自动刷新 → 换日 →
   卖出 → 复盘 → 限价挂单/自动成交/撤单 → 收盘日终 → 隔夜跳空；
4. 结束时把 `window.fetch` 还原成 `window.__e2e.nativeFetch` 再刷新，回到真实后端（**不要 reload**，见「坑」）。

要单独观察假后端状态：

```bash
node tests/e2e/fake-backend.mjs --port 4599 --clock 2026-10-22T09:31:00+08:00
curl localhost:4599/state
curl -X POST localhost:4599/clock -d '{"iso":"2026-10-23T09:31:00+08:00"}'
curl -X POST localhost:4599/quote -d '{"symbol":"000001","last":11.6}'
```

## 3. CDP 走查（真实行情，人工判断手感）

```bash
node tests/e2e/cdp.mjs summary
node tests/e2e/cdp.mjs text .pt-root
node tests/e2e/cdp.mjs click 行情
node tests/e2e/cdp.mjs input '.pt-root input' 000001
node tests/e2e/cdp.mjs eval 'document.querySelector(".pt-receipt")?.innerText'
node tests/e2e/cdp.mjs watch 30          # 盯面板是否被切走/是否刷新
```

走查清单（真实行情下的 9 步）：看行情与时段 → 搜索/自选 → 输入即预览 → 下单拿回报 → 持仓/资金 →
盘后改价看刷新 → 收盘看日终 → 隔夜看 T+1 与今日盈亏 → 复盘看成交/流水/回合。

## 4. 面板 UI 端到端（不开 DSH）

```bash
pnpm build                     # ui-panel 直接读 lib/client.js
mkdir -p tmp/ui-deps && (cd tmp/ui-deps && npm i react@18.3.1 react-dom@18.3.1)
node tests/e2e/ui-panel.mjs    # 0 = 全过；失败打印第一处 DOM 断言
```

做法：把 `lib/client.js` 挂到静态页，用 UMD 版 React/ReactDOM 渲染；页面里把 `window.fetch`
换成假后端（`ui-fake.js`，与 `flow-fake.mjs` 同一思路），再按用户路径点按钮、断言 DOM：
股票面板 → 一揽子导入/预览/下单 → 期货账户切换/搜合约/预览/开仓。不需要调试口，也不会碰到
真实账本；`REACT_UMD_DIR` 可覆盖 UMD 目录，`CHROME` 可覆盖 headless Chromium 路径。

## 5. 一揽子离线断言

```bash
node tests/e2e/offline-basket.mjs   # 0 = 全过
```

用真 `PaperService` + 真 RPC handler + 假行情，覆盖 CSV 预览、费用/整手/剩余现金、逐行成交、
账本落盘、同 `batchId` 幂等与收盘后整批拒绝。数据写 `tmp/`，不碰 `~/.dsh`。

## 坑（都是真踩过的）

- **不要在应用运行时反复 build 这个 link 的包再 reload 页面**：会撞上半写文件 / 模块版本不一致，
  表现为 `@ft/dsh-fft-paper-trading: import failed`，整个 web boot 报 1 entry 未激活。改完一批 → `pnpm build`
  → ⌘Q 重开。用假数据测试时不要 reload 页面，用 `window.fetch` 还原即可。
- **窗口里点着点着面板没了**：多半是点到了侧栏别的会话（标题会变），不是插件崩了；用 `cdp.mjs summary`
  看 `title` 确认。
- **重置的确认框是原生 `window.confirm`**：CDP 能代按，`PT_CONFIRM=1` 时 `cdp.mjs` 自动接受；
  手动驱动时先 `Page.enable` 并处理 `Page.javascriptDialogOpening`，否则 eval 会一直挂着。
- **真实账本不要拿来试**：假后端用 `tmp/e2e-home`；探索性点击时确认面板连的是哪个后端
  （`node tests/e2e/cdp.mjs text .pt-root` 看「初始/时间」是否对得上）。
- **交易时段**：真实后端下收盘后只能预埋限价单；想看成交/持仓/隔夜，用假后端（方法 2）或等开盘。
- 面板的 5 秒刷新只拉账户，不重算预览；报价行随输入/刷新更新，别据此判断「卡住了」。
- 面板的 5 秒轮询要求 `document.visibilityState === 'visible'`：窗口被遮住时撮合心跳会停，
  `flow-fake.mjs` 会打印 `NOTE 自动刷新未在 9 秒内出现` 并补一次刷新，这不是断言失败。
- **页面 fetch 被打歪**（递归 / `Illegal invocation`）：这是 `flow-fake.mjs` 替换 `window.fetch` 后没还原
  的典型后果，整个桌面端的 RPC 都走这个 fetch，表现成「新建会话失败：gateway/internal: client api:
  session/create failed: Failed to execute 'fetch' on 'Window': Illegal invocation」。
  脚本现在把原生实现单独存在 `window.__e2e.nativeFetch`（绝不复用包装器），Ctrl-C 也会还原；
  **被旧版脚本打断过**（`window.fetch.__e2eWrapper === true` 且没有 `nativeFetch`）时，先 ⌘Q 重开，
  或新建 iframe 取回原生：
  `const f=document.createElement('iframe');document.body.appendChild(f);window.fetch=f.contentWindow.fetch.bind(window);f.remove()`
- 假后端不会碰真实账本，但脚本会切 tab、下单：跑之前把窗口留给它，别同时操作会话。
