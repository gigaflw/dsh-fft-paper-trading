# 模拟交易实现参考（补充）

> 外部知识库：记录这些项目**怎么做**、**有什么已知限制**，不承载本仓决策。
> **产品层参考不在这里**：五款产品的调研见
> [`docs/investigation/sim-trading-competitors.html`](../investigation/sim-trading-competitors.html)
> ——TradingView、IG demo、openctp、璇玑（sonhany/xuanji，无 License）、牛牛1号（kunkundi/niuone，Apache-2.0）。
> 本文只补**实现机制层**的四个开源项目，用于核对时段、成交、账本重放这些容易踩坑的地方。
> 本仓的取舍见 [`docs/investigation/sim-trading-p0-p1.md`](../investigation/sim-trading-p0-p1.md) 与
> [`docs/specs/paper-trading/design.md`](../specs/paper-trading/design.md) §19。
> 核对时间：2026-10-21；来源为各项目 `master`/`develop` 的文档与源码，链接见文内。

## 0 来源与版本

| 项目 | 分支 / 提交（核对日） | 许可 | 核对文件 |
| --- | --- | --- | --- |
| QuantConnect Lean | `master` @ `de116c0` | Apache-2.0 | `Common/Orders/Fills/EquityFillModel.cs`、`Common/Orders/Fills/FillModel.cs`、`Common/Securities/SecurityExchangeHours.cs` |
| NautilusTrader | `develop` @ `e831bbd` | LGPL-3.0 | `crates/adapters/sandbox/README.md`、`docs/concepts/accounting.md`、`docs/concepts/event_sourcing.md`、`docs/concepts/backtesting/fill-models.md`、`docs/concepts/backtesting/fill-prices-and-matching.md`、`docs/concepts/architecture.md` |
| freqtrade | `develop` @ `0db79d3` | GPL-3.0 | `docs/configuration.md` |
| exchange_calendars | `master` @ `bbda29f` | Apache-2.0 | `exchange_calendars/exchange_calendar_xshg.py` |

仓库地址：Lean <https://github.com/QuantConnect/Lean>、NautilusTrader
<https://github.com/nautechsystems/nautilus_trader>、freqtrade
<https://github.com/freqtrade/freqtrade>、exchange_calendars
<https://github.com/gerrymanoim/exchange_calendars>。

按上表提交可直接 clone/checkout 复核；本仓不内嵌整份源码，避免 LGPL/GPL 代码维护与仓库体积问题，归档的是来源、版本、许可、关键摘录与结论。

## 1 为什么看这些

模拟盘最难的不是「记一笔成交」，而是三件事：

1. **市场节奏**：交易时段、午休、节假日、收盘/开盘时点、T+1 解锁；
2. **成交假设**：什么时段能成交、按什么价、能不能部分成交、涨跌停/停牌怎么处理；
3. **可重放**：成交与快照必须落成事件，重放不依赖当前行情。

下面四个项目分别在这三点上给了可验证的做法。openctp 的调研已在
[`docs/thirdparty/openctp.html`](openctp.html)，TradingView / IG 的交互调研在
[`tradingview.html`](tradingview.html)、[`ig-demo.html`](ig-demo.html)。

## 2 QuantConnect Lean

- 仓库：<https://github.com/QuantConnect/Lean>（Apache-2.0）
- 定位：多资产回测 + 实盘，C#；回测/paper/live 共用同一套证券与订单模型。

**交易时段**：`Common/Securities/SecurityExchangeHours.cs`

- 每个交易日从 `MarketHours` 取常规/扩展时段；维护 `Holidays`、`BankHolidays`、`EarlyCloses`；
- `IsOpen(localTime, extendedHours)` 判断是否可交易；
- `GetNextMarketOpen` / `GetNextMarketClose` 计算下一次开/收盘，含提前收盘与周末；
- 结论：时段判断是**数据驱动**的（市场小时数据库），不是代码里写死 9:30。

**成交模型**：`Common/Orders/Fills/EquityFillModel.cs`

- 所有 `MarketFill` / `LimitFill` 先过 `IsExchangeOpen(asset, ...)`，**非交易时段不成交**；
- 市价：买用当前 ask、卖用当前 bid，再加 `SlippageModel` 的滑点；
- 限价：只有在 bar 的低价穿过买价（或高价穿过卖价）时才成交；若开盘跳空更有利，按开盘价成交；
- 行情缺失/过旧会等待新鲜数据，不拿已经过期的 bar 价格成交；
- 部分成交：该文件里明确留有 TODO（按 tick/bar volume 做 depth-limited 部分成交），**Lean 的股票默认模型并不做部分成交**。

**对模拟盘的提示**

- 交易所开关门是成交前的第一道门，而不是事后再过滤；
- 收盘/开盘跳空要用开盘价，不要用上一根 bar 的收盘价假装成交；
- 不要因为 Lean 很大就以为「部分成交是默认能力」，它自己也没做完。

## 3 NautilusTrader

- 仓库：<https://github.com/nautechsystems/nautilus_trader>（LGPL-3.0）
- 定位：Rust 核心 + Python API，回测/沙盒/实盘共用内核；文档：
  <https://nautilustrader.io/docs/latest/concepts/architecture/>

**三种运行环境**（`docs/concepts/architecture.md`）

- `Backtest`：历史数据 + 模拟执行；
- `Sandbox`：**实时数据 + 模拟执行**，即 paper trading；
- `Live`：实时数据 + 真实/模拟券商账户。

**沙盒撮合**（`crates/adapters/sandbox/README.md`）

- 用生产级 `OrderMatchingEngine` 对实时行情做模拟成交；
- 支持全部订单类型、可配置 fill model / fee model、**队列位置**、**流动性消耗**；
- 支持现金账户与保证金账户。

**成交价与部分成交**（`docs/concepts/backtesting/fill-prices-and-matching.md`）

- L2/L3：市价单逐档吃深度；限价单作为 taker 吃穿价、作为 maker 用限价；**深度不足时部分成交**；
- L1：只有最优买卖价；市价单吃完 L1 后按「差一档」成交剩余（deterministic residual rule）；
- 成交模型可配置 `prob_fill_on_limit`、`prob_slippage`，并支持 `random_seed` 复现；
- 关键区分：**成交模型**（是否成交、滑点）与**撮合引擎**（价格/数量/队列）是两层。

**账户与账本**

- `docs/concepts/accounting.md`：现金账户全额结算、无杠杆；挂单冻结可用资金；
- `docs/concepts/event_sourcing.md`：run 级 `seq`、快照 + 重放、校验，支持恢复与归档；
- `docs/concepts/order_book.md`：L2/L3 订单簿；没有深度数据时只能走 L1 规则。

**许可注意**

- LGPL-3.0：**不能把源码复制进本仓**；只能借架构与规则，自己实现。

## 4 freqtrade（dry-run）

- 仓库：<https://github.com/freqtrade/freqtrade>（GPL-3.0）
- 文档：<https://www.freqtrade.io/en/stable/configuration/#using-dry-run-mode>

**dry-run 的边界**

- 跑真实行情，但订单不下发到交易所，钱包是模拟的（`dry_run_wallet`）；
- 市价单按**下单时刻的订单簿量**成交，最大滑点 5%；
- 限价单触价成交，否则按 `unfilledtimeout` 超时取消；
- 限价单穿价超过 1% 会转成市价单立即成交；
- 重启后未成交订单仍然保留，并**假设离线期间没有成交**。

**对模拟盘的提示**

- 「真实时间 + 模拟执行」是 paper trading 的标准形态，不需要时间加速；
- 离线期间的处理必须显式定义；freqtrade 选择「不补成交」，这是可复用的保守假设；
- 超时、部分成交、穿价转市价都是**需要写进设计**的策略，而不是实现细节。

**许可注意**

- GPL-3.0：不能复制代码；只能把行为清单当成验收参考。

## 5 exchange_calendars（XSHG）

- 仓库：<https://github.com/gerrymanoim/exchange_calendars>（Apache-2.0）
- 文件：`exchange_calendars/exchange_calendar_xshg.py`

**上海证券交易所日历**

- 开盘 09:30、午休 11:30–13:00、收盘 15:00（Asia/Shanghai）；
- 用预计算节假日表处理调休/长假；
- 日历只描述「开市区间」，**不建模集合竞价**（09:15–09:25、14:57–15:00）。

**对模拟盘的提示**

- 节假日与午休必须来自数据，不能只判断星期几；
- 集合竞价要单独建模，不能把 09:15 当成连续交易；
- 它是 Python 库，本仓 Node 运行时不应为了日历引入 Python；可以借它的时段/节假日口径做对照测试。

## 6 openctp / CTP（补充）

- 本地调研：[`openctp.html`](openctp.html)
- 定位：CTP 期货仿真环境（SimNow 等），提供稳定接口与仿真撮合；
- 可借：接口契约分层、仿真/实盘环境切换；
- 不可直接借：A 股现货的 T+1、100 股手数、涨跌停、现金账户规则。

## 7 横向对比

| 维度 | Lean | Nautilus | freqtrade | 本仓 v0.1 |
| --- | --- | --- | --- | --- |
| 时段门禁 | 数据驱动 MarketHours | 有交易日历/交易状态 | 交易所为准 | 无 |
| 收盘/开盘时点 | 有 next open/close | 有 | 按 candle 收盘 | 首次跨日 tick |
| 部分成交 | 股票模型 TODO | L2 深度可部分，L1 差一档 | 按订单簿量 | 无 |
| 涨跌停/停牌 | 由 BrokerageModel 扩展 | 由交易状态/风控 | 交易所规则 | 无 |
| 现金/保证金 | 有 | 现金 + 保证金 | 现货钱包 | 现金 |
| 事件重放 | 有 | 强（seq + snapshot） | 交易库 | JSONL 事件 |
| 许可 | Apache-2.0 | LGPL-3.0 | GPL-3.0 | 自有 |

## 8 与五产品调研的分工

五产品调研回答「向谁学产品与交互」，本文回答「时段/成交/重放这些机制别人怎么实现」。两边不重复：

| 能力 | 产品层（五产品调研） | 实现机制层（本文） |
| --- | --- | --- |
| 交易时段 / 交易日历 | 牛牛1号：账户总览、交易日历；璇玑：账本日期与审计事件 | Lean 的交易所小时/节假日；exchange_calendars 的 XSHG 时段 |
| 撮合 / 仿真 | openctp：CTPAPI 契约、做市/用户间撮合、仿真环境分层；璇玑：风控失败关闭 | Nautilus 的撮合引擎/成交模型分层；Lean 的交易所开关门与成交规则 |
| 账本 / 对账 / 重放 | 璇玑：独立 F5 账本、十项对账、跨批次幂等、重放、审计事件 | Nautilus 的 event sourcing（seq + 快照） |
| 图表 / 交易标记 | TradingView：K 线、指标、画线、下单 ticket、盘口、交易标记 | —（纯前端渲染，无机制可借） |
| 交易前预览 / 受理与成交分离 | IG demo：双预览、环境同构、流式行情 | —（v0.1 已落地） |
| 复盘 / 视觉 / 空态 | 牛牛1号：收益曲线、操作日志、空态/加载态 | — |

**许可边界**：牛牛 Apache-2.0、openctp BSD-3 可参考实现；璇玑没有 License，**只能学设计，不能复制代码**；TradingView/IG 闭源，只能按公开界面与流量归纳。

## 9 已知坑清单（来自上述实现）

1. 把**取数时间**当行情时间，会让收盘后仍然「行情新鲜」→ 盘后成交。
2. 用自然日 00:00 切交易日，会在半夜解锁 T+1、写错收盘快照。
3. 不判断交易所开关门，市价单在午休/盘后也会成交。
4. 没有深度数据却假装能算盘口和部分成交。
5. 把「部分成交」当成默认能力：Lean 的股票 fill model 自己都还是 TODO。
6. 离线期间的挂单处理没有定义：补成交会造出用户没看到的成交，不补又和「真实撮合」矛盾。
7. 只按星期几算交易日，遇到节假日/调休全错。
8. 直接复制 LGPL/GPL 代码，污染本仓许可。


## 10 关键原文摘录

> 只摘与设计直接相关的短句，用于核对结论；完整实现以对应提交为准。引用文字版权归原作者，许可见 §0。

### 10.1 Lean：成交前先判交易所开关门

`Common/Orders/Fills/EquityFillModel.cs`（`MarketFill`）：

> `// Make sure the exchange is open/normal market hours before filling`
> `if (!IsExchangeOpen(asset, false)) return fill;`

同一文件的限价成交分支：

> `// TODO: Add separate DepthLimited fill partial order quantities based on tick quantity / bar.Volume available.`
> `fill.FillQuantity = order.Quantity;`
> `fill.Status = OrderStatus.Filled;`

结论：Lean 的股票默认模型在时段外不成交，但**默认仍是全量成交**；按深度部分成交是它自己留下的 TODO。

### 10.2 Nautilus：沙盒是实时数据 + 模拟执行

`crates/adapters/sandbox/README.md`：

> `The nautilus-sandbox crate provides a simulated execution client that uses the`
> `OrderMatchingEngine to simulate order execution against live market data.`

同一文件：

> `Configurable fill models, fee models, queue-position tracking, and liquidity consumption.`

`docs/concepts/backtesting/fill-prices-and-matching.md`：

> `A depth order can fill partially when the available crossed size is smaller than its remaining quantity.`

结论：Nautilus 把「撮合引擎 / 成交模型 / 流动性消耗」拆开；L2 才能按深度部分成交，L1 只有最优价 + 差一档规则。

### 10.3 freqtrade：dry-run 的行为清单

`docs/configuration.md`（Using Dry-run mode → Considerations for dry-run）：

> `Orders are simulated, and will not be posted to the exchange.`
> `Market orders fill based on orderbook volume the moment the order is placed, with a maximum slippage of 5%.`
> `Limit orders fill once the price reaches the defined level - or time out based on unfilledtimeout settings.`
> `Open orders ... are kept open after bot restarts, with the assumption that they were not filled while being offline.`

结论：真实行情 + 模拟钱包 + 不补离线成交，是可复用的 paper trading 行为基线。

### 10.4 exchange_calendars：XSHG 时段

`exchange_calendars/exchange_calendar_xshg.py`：

> `Open time: 9:30 Asia/Shanghai`
> `Lunch break: 11:30 - 13:00 Asia/Shanghai`
> `Close time: 15:00 Asia/Shanghai`

同一文件用 `precomputed_shanghai_holidays` 处理节假日；没有集合竞价阶段。

结论：时段与节假日可作对照数据；集合竞价要自己建模。
