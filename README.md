# @ft/dsh-fft-paper-trading

A 股与商品期货模拟盘：输入即预览成本、下单、持仓、复盘；批量按 CSV 权重一次买入。
账本是本地追加的事件文件，重启后重放恢复。

本仓库是插件的独立仓库，**仓库根即包根**：既可以单独安装，也可以随 `dsh-fft-bundle`（主仓）一起安装。

## 使用

- 侧栏「模拟交易」：顶部 `股票 | 期货` 切换账户，两本账互不影响。
  - 股票：交易、批量、行情、持仓、订单、复盘。
  - 期货：交易、持仓、订单、复盘（无行情页；交易页内搜索合约）。
- 对话工具：
  - 股票：`paper_account`、`paper_quote`、`paper_preview`、`paper_order`、`paper_cancel`、`paper_status`、`paper_tick`、`paper_review`。
  - 期货：`futures_account`、`futures_contracts`、`futures_quote`、`futures_preview`、`futures_order`、`futures_cancel`、`futures_positions`、`futures_review`。

股票账户首次打开自动开户（10 万 CNY）；买入按 100 股整数倍，卖出受 T+1 可卖限制。
期货账户首次打开自动开户（100 万 CNY），只做商品期货日盘（09:00–11:30、13:30–15:00），
按手交易、保证金占用、T+0 平仓，15:30 按收盘价结算并做强平/到期检查；夜盘、股指/国债、
交割与移仓不在本期。

交易页填完代码/方向/数量即自动取行情并算费用；市价按最新价一次全成，限价未穿越才挂单（宿主每 5 秒重判，免费/降级行情 5 分钟一次），当日有效。
批量填预算后预览每只股数/费用/剩余现金，确认后一批成交；同一批次重试不会重复下单。

## 安装

```sh
dsh plugin add /Users/ben/workspace/dsh/dsh-fft-paper-trading
```

包的 `cordis.patch.yml` 自带宿主半、RPC 路由与浏览器半，安装即生效。开发期用
`node scripts/sync-profile.mjs` 同步成 desktop profile 的稳定副本（之后 ⌘Q 重开），避免
`link:` 到仓库时被热重载撞上构建中间态。

独立安装时：

- 行情与交易日历来自宿主的 `ftshareData` 服务（随 `dsh-fft-bundle` 安装或另装
  `@ft/dsh-fft-ftshare`）。没有该服务时行情降级为「不可用」，股票可手填参考价按市价成交、
  期货可手填参考价平仓；交易日历退回工作日。
- 没有 FTShare API Key 时走免费档：实时日K/分钟K 不可用，股票报价回退到历史日K（面板显示
  「来源 FTShare 免费版」，盘中即上一交易日收盘），行情页板块由免费全市场列表在本地筛选；
  匿名额度 500 次/天，用尽时面板提示配置 Key 或稍后重试。
- 股票 K 线视图由 `dsh_kline` 通过 slot 提供；没装时显示内置简图。期货本期不接 K 线。

## 边界

- 仅模拟，不接实盘、不构成投资建议。
- 成交价 = 判定时行情最新价（股票 2 位小数、期货按合约 tick 量化），无滑点、不限量；无限价穿越或
  非可交易时段才挂单。
- 股票 T+1 用工作日判定；不处理节假日、分红送转与除权。
- 期货不做部分成交、夜盘、组合保证金、交割、自动移仓、盘中强平；日结算不把浮盈亏划入现金
  （只按收盘价重算权益并写日快照）。
- 单账户/单币种（每类资产）；股票与期货各自单账户。

## 数据

- 股票：`$DSH_HOME/paper-trading/default/events.jsonl`
- 期货：`$DSH_HOME/paper-trading/futures/events.jsonl`
- 期货合约索引缓存：`$DSH_HOME/paper-trading/futures/contracts.json`
- 行情备选：`$DSH_HOME/paper-trading/shortlist.json`（UI 偏好，非账本）

一行一事件（0600 权限）。重置会先备份到同目录 `backups/`，再把账本原子重写为单条 genesis。
账户锁定时横幅直接显示失败原因与账本绝对路径，可「导出账本」或「复制路径」；Agent 侧用
`paper_export` / `futures_account` 取同一组信息（只读）。

## 开发

```bash
pnpm install
pnpm build     # tsc + 浏览器半
pnpm test      # 108 个用例：股票/期货领域、撮合、风控、重放、服务、RPC、装配、客户端静态断言
node scripts/scenario.mjs
node scripts/sync-profile.mjs   # 同步到 desktop profile 的稳定副本
```

端到端（详见 [tests/e2e/README.md](tests/e2e/README.md)）：

```bash
node tests/e2e/offline-basket.mjs    # 批量：预览/下单/幂等
node tests/e2e/futures-offline.mjs   # 期货：开仓/重启/平仓/结算
node tests/e2e/ui-panel.mjs          # 浏览器面板：批量 + 期货全流程（需 react-dom UMD）
```

`lib/` 是构建产物且**提交进 git**（git 安装不在安装期构建）。

设计：[docs/design.md](docs/design.md) §20 期货与批量｜MVP 范围：[docs/mvp.md](docs/mvp.md)｜
需求：[docs/specs/](docs/specs/)｜发布记录：[docs/releases.md](docs/releases.md)
