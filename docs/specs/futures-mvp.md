# 期货 MVP 决策（已拍板）

> 状态：已定并实现（2026-10-22，见 [design.md](../design.md) §20）。本文只写「相对 [futures-spec.md](futures-spec.md) 的裁剪与结论」，不重复需求全文。
> 原则：MVP（基本闭环、可重放、可降级），架构冲击小，UI 与股票页一致；复杂但非闭环的功能留给后续。
> 落地架构写进 design.md §20（实现完成后补）。

## 1 决策表（对 spec §13 的拍板）

| # | 结论 | 说明 |
| --- | --- | --- |
| D1 夜盘 | **不做** | 只做商品期货日盘：09:00–11:30（含 10:15–10:30 小节休息）、13:30–15:00。21:00 后与非交易时段只读，不下单不撮合。交易日按自然日 + 15:30 结算推进，不处理「夜盘归次日」。 |
| D2 初始资金 | 100 万元 | `DEFAULT_FUTURES_SETTINGS.initialCashCents = 1_000_000_00` |
| D3 风控线 | 强平 100%、警告 80% | 风险度 = 保证金 / 权益 |
| D4 到期 | 距最后交易日 ≤ 3 个交易日禁开；到期日收盘强平 | 用交易日历算；不自动移仓 |
| D5 平今 | 按持仓开仓日判断：当日开当日平用 `offset_today_fee`，否则 `trading_fee` | 所有交易所统一这套逻辑（数据里多数两值相同） |
| D6 多空保证金 | 分开收取 | 不实现组合保证金/单向大边 |
| D7 保证金上浮 | 0 | `settings.marginUplift = 0` |
| D8 手续费加收 | 1.0 | 只收交易所标准 |
| D9 可交易合约 | 当日 `volume > 0` | 无成交拒单，提示「当日无成交」 |
| D10 Agent 工具 | 7 个 `paper_futures_*` | 与 `paper_stock_*` 同构、不复用 |
| D11 面板 | 账户切换 + 交易/持仓/订单/复盘 4 页签 | **不做期货行情页**；交易页内搜索选合约。右栏显示合约要素（乘数/tick/保证金/到期/涨跌停），不放 K 线；底部常驻持仓/挂单，与股票页同构 |
| D12 品种 | 只做商品期货：SHFE / INE / DCE / CZCE / GFEX | 排除 CFFEX（无结算参数、时段特殊）与 NIB（无行情） |
| D13 出入金 | 做：注资/提款只动可用资金，盈亏剔除净入金 | 与股票共用追加式 `cash.deposit`/`cash.withdraw` 事件；保证金不可提 |
| D14 到期处理 | 收盘强平 | 不自动移仓 |
| D15 强平时点 | 收盘后检查并强平 | 不做盘中实时强平 |
| D16 盯市价 | 统一用当日收盘价 | `settle` 有值也不切换口径，保证跨所可比 |
| D17 期货备选 | 不做 | 搜索/最近使用即可 |

补充裁剪（本次新增结论）：

- **日结算不重写持仓成本**：收盘只用当日收盘价计算浮动盈亏与权益、写日快照、跑强平；不把浮盈浮亏划入现金、不改持仓均价。权益 = 现金 + 保证金 + 按收盘价的浮动盈亏。后续要做「结算价划转」再单独一批。
- **限价单只在可撮合时段接受**：不做盘前预埋、不做夜盘预埋；收盘未成交自动过期。
- **无行情/无涨跌停/无保证金率时失败关闭**：拒单并给可读原因，不猜参数。手续费/结算参数缺失时按 0 计并在预览里 warning（CFFEX 已排除，商品通常有数据）。
- **合约索引缓存**：按交易日缓存在内存 + `$DSH_HOME/paper-trading/futures/contracts.json`；跨日失效；刷新按钮强制重取。
- **期货账户独立**：账本 `$DSH_HOME/paper-trading/futures/events.jsonl`，账本版本 `futures-v1`，与股票账户互不读取。

## 2 契约与端点（实现必须与此一致）

跨平面类型：`src/futures-contract.ts`；行情端口：`src/data/futures-market-data-port.ts`。

RPC（仍走 `/api/ft-paper-trading`）：

| endpoint | payload | 返回 |
| --- | --- | --- |
| `futures/account/get` | — | `FuturesAccountView` |
| `futures/account/reset` | `{ confirm: true }` | `FuturesAccountView` |
| `futures/account/export` | — | `FuturesLedgerExport` |
| `futures/contracts` | `{ query?, exchange?, limit?, refresh? }` | `{ state, contracts, notice? }` |
| `futures/quote` | `{ symbols: string[] }` | `{ state, quotes, notice? }` |
| `futures/status` | — | `FuturesMarketStatus` |
| `futures/preview` | `FuturesDraft` | `FuturesPreviewView` |
| `futures/order` | `{ draft: FuturesDraft, requestId? }` | `FuturesOrderView` |
| `futures/cancel` | `{ orderId }` | `FuturesOrderView` |
| `futures/positions` | — | `FuturesPositionView[]` |
| `futures/orders` | — | `FuturesOrderView[]` |
| `futures/trades` | — | `FuturesFillView[]` |
| `futures/review` | `{ period }` | `FuturesReviewView` |
| `futures/tick` | — | `FuturesTickView` |

合约 `symbol` 一律用行情接口口径（`RB2611.SHFE`）；后缀归一在数据层完成，服务与 UI 不认第二套后缀。

## 3 UI（与股票页同构）

- 顶部标题下加账户切换：`股票 | 期货`（分段按钮）；股票页原样保留。
- 期货统计卡：`总权益 / 可用资金 / 保证金占用 / 风险度`（风险度 ≥80% 用警示色）。
- 交易页：合约搜索（代码/品种/中文名）→ 选中回填；方向 `开多/开空/平多/平空` 分段；手数；市价/限价；买入按钮文案 `开多/开空/平多/平空`；预览显示保证金、手续费、占用后可用、最大可开手数、涨跌停区间、风险度。
- 交易页右栏：合约要素卡（乘数、tick、保证金率、到期日、涨跌停、最新价/昨结）。
- 持仓页：合约/方向/手数/今仓/均价/最新价/浮盈亏/保证金/到期日 + 行内「平仓」。
- 订单页：挂单（撤单）+ 历史。
- 复盘页：权益曲线、最大回撤、成交统计、已实现盈亏、分品种统计。
- 底部常驻「持仓/挂单」卡复用股票页的 `.pt-trade-book` 交互。
- 空态、错误、4 态行情、加载文案与股票页一致；不新增大段说明。

## 4 验收（MVP 子集）

| # | 用例 | 期望 |
| --- | --- | --- |
| F1 | 预览开多 rb2611 1 手 | 保证金、手续费、占用后可用、最大可开手数、风险度均为正数 |
| F2 | 日盘开多/开空/平多/平空 | 成交价 = 最新价按 tick 量化；持仓按方向分行 |
| F3 | 保证金不足 | 拒单，提示差额，现金与持仓不变 |
| F4 | 撮合时段外下单 | `SESSION_CLOSED`；限价单也只能在可撮合时段下 |
| F5 | 限价穿越/未穿越 | 穿越以最新价成交；未穿越挂单、撤单后现金不变、收盘过期 |
| F6 | 平今费用 | 当日开当日平按 `offset_today_fee`；隔日平按 `trading_fee` |
| F7 | 收盘盯市 | 日快照权益 = 现金 + 保证金 + 按收盘价重算的浮盈亏 |
| F8 | 风险度 ≥100% | 收盘强平，写事件、面板提示 |
| F9 | 距到期 ≤3 交易日开仓 | 拒绝并提示临近交割 |
| F10 | 杀进程重启 | 现金、持仓、订单、权益与重启前一致（重放） |
| F11 | 无行情/接口失败 | 面板与账本可用，可看持仓与历史；可手填参考价平仓 |
| F12 | 股票/期货并存 | 两本账互不影响，各自可重置 |
| F13 | 批量买入 N 只 | 预览数量/费用/剩余现金正确；确认后 N 笔订单按序成交，总花费 ≤ 预算 |
| F14 | 批量重复提交 | 同 `batchId` 不重复下单 |
| F15 | 回归 | 股票交易/行情/持仓/订单/复盘/K 线/tick 无变化 |

## 5 不在本次

- 夜盘、股指/国债、组合保证金、交割、自动移仓、盘中强平、期货 K 线、期货行情页、备选、工具卡。

## 6 分工与分支

| 分支 | 范围 |
| --- | --- |
| `feat/basket` | 批量：core/basket + service/rpc + 测试（不含 UI） |
| `feat/futures` | 期货后端：contract 之后的 core/store/service/rpc/tools/index 装配 + 测试 |
| `feat/futures-data` | 期货 FTShare 数据适配器 + 假数据测试 |
| `feat/client-ui` | 全部客户端 UI（批量页签 + 期货账户切换/四个页签）+ client 测试 |
| dev 集成 | Lead 合并、FTShare 适配器装配、端到端测试、文档 |

分支持久化在 `.worktrees/<name>`；合并进 `dev` 用 rebase + 快进，不 push。
