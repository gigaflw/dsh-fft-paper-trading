# @ft/dsh-fft-paper-trading

A 股模拟盘：输入即预览成本、下单、持仓、复盘。账本是本地追加的事件文件，重启后重放恢复。

本仓库是插件的独立仓库，**仓库根即包根**：既可以单独安装，也可以随 `dsh-fft-bundle`（主仓）一起安装。

## 使用

- 侧栏「模拟交易」：交易、持仓、订单、复盘四个页签。
- 对话工具：`paper_account`、`paper_quote`、`paper_preview`、`paper_order`、`paper_cancel`、`paper_status`、`paper_tick`、`paper_review`。

首次打开自动开户（10 万 CNY）。买入按 100 股整数倍；卖出受 T+1 可卖限制。

交易页填完代码/方向/数量即自动取行情并算费用；市价按最新价一次全成，限价未穿越才挂单（宿主每 5 秒重判），当日有效。

## 安装

```sh
dsh plugin add /Users/ben/workspace/dsh/dsh-fft-paper-trading
```

包的 `cordis.patch.yml` 自带宿主半、RPC 路由与浏览器半，安装即生效。开发期用
`node scripts/sync-profile.mjs` 同步成 desktop profile 的稳定副本（之后 ⌘Q 重开），避免
`link:` 到仓库时被热重载撞上构建中间态。

独立安装时：

- 行情与交易日历来自宿主的 `ftshareData` 服务（随 `dsh-fft-bundle` 安装或另装
  `@ft/dsh-fft-ftshare`）。没有该服务时行情降级为「不可用」，可以手填参考价按市价成交，
  T+1 用工作日日历。
- K 线视图由 `dsh_kline` 通过 slot 提供；没装时显示内置简图。

## 边界

- 仅模拟，不接实盘、不构成投资建议。
- 成交价 = 判定时行情最新价（2 位小数），无滑点、不限量、无行情 TTL；只有限价未穿越或非连续竞价时段才挂单。
- T+1 用工作日判定；不处理节假日、分红送转与除权。
- 单账户、单币种；永不部分成交；无止损单、条件单。

## 数据

`$DSH_HOME/paper-trading/default/events.jsonl`（一行一事件，0600 权限）。重置会先备份到同目录
`backups/`，再把账本原子重写为单条 genesis；账户锁定时可用面板横幅的「导出账本」取出原文与路径。

## 开发

```bash
pnpm install
pnpm build     # tsc + 浏览器半
pnpm test      # 42 个用例：费用/撮合/风控/重放/服务/存储/并发/调度/装配/品牌兜底
node scripts/scenario.mjs
node scripts/sync-profile.mjs   # 同步到 desktop profile 的稳定副本
```

`lib/` 是构建产物且**提交进 git**（git 安装不在安装期构建）。

设计：[docs/design.md](docs/design.md)｜MVP 范围：[docs/mvp.md](docs/mvp.md)｜发布记录：[docs/releases.md](docs/releases.md)
