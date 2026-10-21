# @ft/dsh-fft-paper-trading

A 股模拟盘：查行情、预览成本、下单、持仓、复盘。账本是本地追加的事件文件，重启后重放恢复。

## 使用

- 侧栏「模拟盘」：交易、持仓、订单、复盘四个页签。
- 对话工具：`paper_account`、`paper_quote`、`paper_preview`、`paper_order`、`paper_cancel`、`paper_status`、`paper_tick`、`paper_review`。

首次打开自动开户（10 万 CNY）。买入按 100 股整数倍；卖出受 T+1 可卖限制；限价单按当日有效。

## 边界

- 仅模拟，不接实盘、不构成投资建议。
- 行情来自 FTShare；取不到行情时可填参考价按市价成交。
- T+1 用工作日判定；不处理节假日、分红送转与除权。
- 单账户、单币种；无部分成交、止损单、条件单。

## 数据

`$DSH_HOME/paper-trading/default/events.jsonl`（一行一事件，0600 权限）。重置会先备份到同目录 `backups/`。

## 开发

```bash
pnpm build     # tsc + 浏览器半
pnpm test      # 14 个用例：费用/撮合/风控/重放/服务/存储/装配
node scripts/scenario.mjs
```
