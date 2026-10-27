# 批量买入 v1：开发规格

> 状态：v1 **已实现**（2026-10-22，见 design.md §20）；本文保留为验收依据。
> 范围：CSV（代码 + 权重）导入 → 按权重计算买入股数 → 预览 → 一次批量下单。
> 非目标：卖出/再平衡、限价、盘后预埋、挂单资金预占、Agent 工具、组合持久化。

## 1 目标与边界

**一句话**：用户导入一份「代码 + 权重」的 CSV，填一个预算，看到每只买多少股、花多少钱、剩多少现金，确认后一次性提交。

**v1 只做**

- 买入（`side = buy`）。
- 市价单（`type = market`），只在连续竞价时段（09:30–11:30、13:00–14:57）提交。
- 最多 20 只；按 100 股整手取整；沿用现有费用、涨跌停、停牌、T+1、账本规则。
- 客户端新增「批量」页签；RPC 新增 `basket/preview`、`basket/place`。

**v1 不做**

- 卖出、按目标权重再平衡、零股处理。
- 限价单、盘后/午休预埋、未成交挂单。
- 挂单资金预占（现有 P2 未做，见 [design.md](../design.md) §19.11）。
- 命名组合、保存/复用、CSV 导出、模板下载。
- Agent 工具（`paper_stock_basket_*`）。
- 客户端拆分、批量报价适配器优化。

## 2 用户流程

```
批量页签
  → 选择 CSV 文件（代码 + 权重）
  → 填预算（默认可用现金）
  → 点「批量预览」
  → 表格：目标权重 / 目标金额 / 股数 / 金额 / 费用 / 实际权重 / 状态
  → 汇总：合计金额、费用、剩余现金、成交后现金；零手/无行情/停牌提示
  → 点「确认下单」
  → 逐行显示成交/拒绝；账户、订单、持仓刷新
```

预览是只读的；下单使用预览产出的 `{ symbol, qty }`，不重新按权重重算，保证用户确认的数量就是提交的数量。

## 3 CSV 格式

只认两列：

```csv
代码,权重
600519,30%
000001,20%
300750,50%
```

规则：

- 第一列代码，第二列权重；多余列忽略。
- 表头可选：第一行第二列不是数字时按表头跳过。
- 权重支持 `0.3` 或 `30%`；无 `%` 且数值大于 1 时按百分数解析并提示；`1` 视为 100%。
- 权重必须大于 0；非法值按行报错，不影响其他行。
- 合计自动归一；偏离 100% 时提示「权重合计 X%，已按比例归一」。
- 重复代码合并权重并提示。
- 空行、以 `#` 开头的行忽略。
- 代码接受裸 6 位、`600519.SH`、`SH600519` 三种写法，解析后保留市场为 canonical id（指数/基金不能买入，按行报错）。
- UTF-8 文本，去掉 BOM；不支持字段内逗号/引号转义（v1 不需要）。
- 最多 20 只（合并重复后）；超过整份拒绝，不静默截断。

解析结果：

```ts
interface BasketCsvRow {
  symbol: string
  weight: number // 已归一，0..1
}
```

按行错误用 `BasketIssue` 表示，类型见 §6。

## 4 买入股数分配

输入：解析后的行、每只的 `Quote`、预算、`PaperSettings`。

1. 预算 `budgetCents` 取「用户输入」与「可用现金」的较小值；输入非正数报错。
2. 每只只使用可用行情：`last > 0` 且 `status !== 'suspended'`。
   - 无行情 → 状态 `no_quote`，不分配。
   - 停牌 → 状态 `suspended`，不分配。
   - 被排除标的的预算不摊给其他标的，留作现金。
3. 价格：`price = roundPrice(quote.last)`。
4. 目标金额：`targetCents = floor(budgetCents * weight)`（权重已归一到 1）。
5. 初始股数：`qty = floor(targetCents / amountCents(price, 100)) * 100`。
6. 金额与费用：`amountCents = amountCents(price, qty)`；`feesCents = computeFees(amountCents, 'buy', settings).totalCents`。
7. 费用回冲：若 `Σ(amountCents + feesCents) > budgetCents`，从 `amountCents / targetCents` 最大（占用目标最满）的行开始逐手减 100 股，直到装得下；减到 0 为止。
8. 实际权重：`actualWeight = amountCents / budgetCents`。
9. 汇总：
   - `totalAmountCents`、`totalFeesCents`
   - `residualCents = budgetCents - totalAmountCents - totalFeesCents`
   - `cashAfterCents = cashCents - totalAmountCents - totalFeesCents`

行状态：

| 状态 | 含义 |
| --- | --- |
| `ok` | 可买，`qty > 0` |
| `zero_lot` | 目标金额不足 1 手；提示「一手约 X 元，目标 Y 元」 |
| `no_quote` | 没有可用行情 |
| `suspended` | 停牌 |

提示（`warnings`）：

- 权重已归一 / 重复代码已合并。
- N 只不足 1 手；N 只无行情或停牌，未配。
- 剩余现金 X 元（Y%），主要来自整手取整。
- 当前时段不能市价成交，只能预览。

没有可用行（全部无行情/0 手）时不报错，返回空计划与提示，客户端禁用确认；显式传入的预算非正数则报 `INVALID_ARGUMENT`。

## 5 下单规则

`basket/place` 只接受预览产出的行，结构见 §6 `BasketOrderInput`。

校验（写账本前）：

1. `rows` 1..20 行、代码不重复、`qty` 为正且是 100 的整数倍。
2. 账户未锁定；当前时段允许市价单（复用 `canSubmit(phase, 'market')`）。
3. 一次 `quotes(symbols)` 取全部行情；任何一行没有 `last > 0` 或停牌，整批拒绝（`QUOTE_UNAVAILABLE` / `SUSPENDED`），避免半篮子。
4. 逐行 `checkOrder` 预检（涨跌停、单笔金额上限等）；任何一行不通过，整批拒绝并返回该行的错误码/消息。
5. 总成本预检：`Σ(amount + fees) > 可用现金` 时整批拒绝（`INSUFFICIENT_CASH`），不静默缩量。

写入：

- 一个 `repo.transact` 内按输入顺序逐行 `submit`，全部事件一次落盘。
- 每行 `requestId = `${batchId}:${symbol}``；事务内先按 `requestId` 查已有订单，命中且数量一致则直接复用，因此同一批重试不会重复下单；数量不一致返回 `INVALID_ARGUMENT`。
- 预检覆盖可预知失败（行情、停牌、涨跌停、单笔上限、总成本、手数），任何一行不通过都整批不写；预检通过后事务内仍可能因并发状态变化被 `submit` 拒绝，此时照常写 `order.rejected` 并继续其他行，逐行返回结果。
- 使用同一批报价、同一 `now`、同一 `tradeDate`、同一 `phase`。
- 不新增账本事件，不改 `Order` 结构；`batchId` 只用于 `requestId`，不落账。
- 返回汇总 `cashAfterCents`。

`batchId` 由客户端生成（`crypto.randomUUID()`）；缺省时服务端生成，但只有显式传入才能幂等重试。

## 6 契约与 RPC

`contract.ts` 新增（无运行时依赖）：

```ts
type BasketRowStatus = 'ok' | 'zero_lot' | 'no_quote' | 'suspended'

interface BasketIssue {
  line: number // 1 起；0 表示整份文件
  message: string
}

interface BasketPlanRow {
  symbol: string
  name?: string
  weight: number
  targetCents: number
  price?: number
  qty: number
  amountCents: number
  feesCents: number
  actualWeight: number
  status: BasketRowStatus
  warning?: string
}

interface BasketPreview {
  budgetCents: number
  cashCents: number
  rows: BasketPlanRow[]
  issues: BasketIssue[]
  warnings: string[]
  totalAmountCents: number
  totalFeesCents: number
  residualCents: number
  cashAfterCents: number
  session: MarketStatus
}

interface BasketOrderInput {
  symbol: string
  qty: number // 100 的整数倍，> 0
}

interface BasketOrderRowResult {
  symbol: string
  order?: OrderView
  error?: string
}

interface BasketOrderResult {
  batchId: string
  rows: BasketOrderRowResult[]
  cashAfterCents: number
}
```

RPC：

| endpoint | payload | 返回 |
| --- | --- | --- |
| `basket/preview` | `{ csv: string, budgetCents?: number }` | `BasketPreview` |
| `basket/place` | `{ batchId?: string, rows: BasketOrderInput[] }` | `BasketOrderResult` |

校验：

- `csv` 非空、≤ 32 KiB；`budgetCents` 可选，正整数。
- `rows` 1..20；`batchId` 可选，≤ 100 字符。
- 错误码复用现有：`INVALID_ARGUMENT`、`ACCOUNT_BLOCKED`、`INSUFFICIENT_CASH`、`QUOTE_UNAVAILABLE`、`SUSPENDED`、`SESSION_CLOSED`、`AUCTION_ONLY`、`PRICE_LIMIT`、`MAX_NOTIONAL`。
- 解析问题通过 `BasketPreview.issues` 返回，不抛异常；结构性错误才抛。

## 7 代码落点

| 文件 | 改动 |
| --- | --- |
| `src/core/basket.ts`（新） | `parseBasketCsv` + `allocateBasket`，纯函数，无 IO |
| `src/contract.ts` | 上述类型 |
| `src/service/paper-service.ts` | `basketPreview` / `basketPlace`，复用 `sync`、`fetchQuotes`、`checkOrder`、`transact` |
| `src/service/rpc.ts` | `basket/preview`、`basket/place` 与 payload 校验 |
| `src/client/index.js` | `BasketTab` + 新页签；不改 K 线、交易票、行情页 |
| `tests/basket.test.mjs`（新） | 解析、分配、整手、费用回冲 |
| `tests/service.test.mjs` | 预览/下单/时段/幂等/整批拒绝 |
| `tests/rpc.test.mjs` | 新 endpoint 校验 |

不改：`store/`、`core/engine.ts`、`core/risk.ts`、`core/ledger.ts`、`core/types.ts`、`data/`。

## 8 客户端

交易页签之后新增「批量」页签，内容独立于单笔交易。

```text
批量买入
  [选择 CSV] 文件名
  预算 [100000.00] 元     [批量预览]
  提示：两列「代码,权重」，最多 20 只；仅连续竞价时段可下单

预览
  代码 名称 目标权重 目标金额 股数 金额 费用 实际权重 状态
  合计：金额 / 费用 / 剩余现金 / 成交后现金
  解析问题、提示

[确认下单]  → 逐行结果：代码 / 状态 / 数量 / 成交价 / 原因
```

实现要点：

- `BasketTab` 自持状态：`csv`、`fileName`、`budget`、`preview`、`result`、`busy`、`error`；切走页签即清空（v1 接受）。
- 文件读取用 `await file.text()`；不引入 CSV 库，解析全部在宿主。
- 预览、下单都走 `rpc()`；下单后调用 Dashboard 的 `refreshAll()` 刷新账户/订单/成交。
- 「确认下单」禁用条件：无 `qty > 0` 的行、`preview.session.canMatch === false`、账户锁定、`busy`。
- 表格复用 `Table` / `.pt-table-wrap`；文件与预算行复用 `.pt-row` / `.pt-field`；不新增大段说明文字。
- 状态文案：可买 / 不足 1 手 / 无行情 / 停牌；错误码仍只在 `title` 或详情里。
- 不新增依赖、不改 `scripts/build-client.mjs`；客户端拆分另立重构任务。

## 9 测试与验收

**单元**

- 解析：有/无表头、`30%`、`0.3`、`30`、重复合并、非法行、空文件、超过 20 只。
- 分配：10 万 4 只（高价股 0 手）、100 万、费用回冲后不超预算、无行情/停牌不摊权重、实际权重之和 ≤ 1、剩余现金正确。
- 下单：连续竞价全部成交；非连续时段拒绝；总成本不足整批拒绝；同一 `batchId` 重试不重复；单行预检失败整批不写；账户锁定。
- RPC：`basket/preview` / `basket/place` 参数校验；未知 endpoint 行为不变。

**人工验收**

1. 导入 4 只各 25% 的 CSV，10 万预算：高价股显示「不足 1 手」，合计金额 + 费用 + 剩余现金正确。
2. 连续竞价点确认：N 笔全部成交，持仓/现金/订单与账本一致，总花费 ≤ 预算。
3. 收盘后预览：提示不可市价成交，确认按钮禁用；直接调 `basket/place` 返回 `SESSION_CLOSED` / `AUCTION_ONLY`。
4. 同一 `batchId` 重放：订单数不增加。
5. 权重合计 90%：提示已归一；超过 20 只：整份拒绝并说明。
6. 单笔交易、行情页、K 线、tick、复盘无回归。

## 10 已定决策

| # | 决策 | 理由 |
| --- | --- | --- |
| B1 | CSV 只认「代码 + 权重」 | 最小格式；限价/备注等后续再加 |
| B2 | 只做买入 + 市价 + 连续竞价 | 避开挂单资金预占、T+1 卖出、盘后语义 |
| B3 | 前端不做买入股数分配 | 费用/整手/行情规则只保留一份 |
| B4 | 批量下单走一个事务 | 一次落盘、报价一致、重试幂等 |
| B5 | 不做「每只至少 1 手」 | 避免预算不足时超配；0 手明确提示 |
| B6 | 不做部分成交/全成或全不成的新账本事件 | 复用现有 `submit`，逐行结果足够 |
| B7 | 不做 Agent 工具 | 先验证 UI 闭环，后续复用同一 service 方法 |

## 11 后续（不在 v1）

1. 限价 + 盘后预埋 + 挂单资金预占。
2. 卖出/再平衡（按目标权重、T+1、零股）。
3. Agent 工具 `paper_stock_basket_preview` / `paper_stock_basket_order`（CSV 文本）。
4. 命名组合、保存/复用、CSV 模板与持仓导出。
5. `quotes()` 批量适配器；20 只以上；客户端拆分与打包器。

## 12 已知风险

- **行情延迟**：`quotes(symbols)` 目前适配器内部逐只请求；20 只可能较慢。v1 用加载态并限制 20 只；若实测超过约 10 秒，再补批量快路径。
- **整手/最低佣金**：10 万账户可能只投出不到一半；预览必须显示 0 手与剩余现金，避免用户误以为满仓。
- **价格漂移**：预览到确认之间价格变化由 `basket/place` 的整批预检兜底；总额不足时整批拒绝，要求重新预览。
- **时段**：非连续竞价完全不可用；这是 v1 的明确取舍，不是缺陷。
