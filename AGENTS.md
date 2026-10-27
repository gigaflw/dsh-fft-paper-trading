# AGENTS.md

本仓库是 A 股模拟盘插件 **@dsh-ft/dsh-fft-paper-trading** 的独立仓库，既可以独立安装，也可以随 dsh-fft-bundle 一起安装。

## 本机环境

- 插件数据：`$DSH_HOME/paper-trading/`

## 文档

- 根 README 是中英对照对：`README.md`（英文）+ `README.zh.md`（中文），H1 下各带语言切换行。改任意一侧必须在同一次改动里同步另一侧；`pnpm test` 会校验配对、切换行与结构对齐（标题层级、代码块逐字节一致、列表/表格/链接一一对应），也可单独跑 `pnpm run verify:translation`。