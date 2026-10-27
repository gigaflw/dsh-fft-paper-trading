# Changelog

本文件记录 `@dsh-ft/dsh-fft-paper-trading` 的对外变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[SemVer](https://semver.org/lang/zh-CN/)。

## [0.6.0] - 2026-10-27

### Added

- 账本自动快照：载入成功且未锁定时，若最新自动快照超过 24 小时则备份一份，保留最近 10 份
- `paper_ledger` 工具与 `ledger/list` / `ledger/restore` / `ledger/backup` 路由：锁定的账户可从备份恢复，进程内生效，无需重启 DSH
- 恢复前自动保留当前账本（`events-pre-restore-*`），恢复本身可回退

### Changed

- v3 账本载入时自动迁移到 v4（迁移前备份、迁移后校验），不再直接锁户；不可迁移或更新的版本仍锁户，但提示改用对应版本插件或恢复快照
- 期货账本补上版本门禁，与股票账本一致
- 锁定提示从「请重置」改为「可从备份恢复」；重置确认框说明旧账本会先归档
- 破坏性：Agent 工具名统一为 `paper_<asset>_<action>`（`paper_stock_*` / `paper_futures_*`，跨账本的 `paper_ledger` 例外），工具面从 19 个收窄到 15 个：`paper_account`+`paper_status` 合并为 `paper_stock_account`，`futures_account`+`futures_positions` 合并为 `paper_futures_account`，删 `paper_tick`（宿主调度器已驱动）与 `paper_export`（账本信息见 `paper_ledger`），`paper_market` 去掉列表动作并补声明搜索 `limit`
- 每个工具只声明自己读取的参数并标必填项：工具 schema 从约 21.8k 字符降到约 5.4k（约 -75% 固定 token）

### Fixed

- 只安装未使用也不再持续请求 FTShare：空持仓/无挂单的期货 tick 不再拉合约索引；合约索引失败后 60 秒内走负缓存，不再每 5 秒重试

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.5.1` → `0.6.0`，依赖与内联版本不变
- `@dsh-ft/dsh-fft-settings`：`0.5.0`（registry 依赖）
- `@dsh-ft/dsh-fft-ftshare`：`0.3.0`（registry 依赖）
- `DSH Kline`：`0.4.0-ft.2`（仍内联）

## [0.5.1] - 2026-10-27

### Changed

- 插件市场条目补齐商店图标与截图清单，安装前可预览交易、复盘与期货界面
- 发布链路整理：发版说明改为共享渲染器生成，镜像推送只输出仍需推送的分支与 tag

### Fixed

- 修复发布作业以相对路径传入产物、以及在 registry 尚未出现新版本时判定失败的问题

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.5.0` → `0.5.1`，依赖与内联版本不变
- `@dsh-ft/dsh-fft-settings`：`0.5.0`（registry 依赖）
- `@dsh-ft/dsh-fft-ftshare`：`0.3.0`（registry 依赖）
- `DSH Kline`：`0.4.0-ft.2`（仍内联）

## [0.5.0] - 2026-10-26

### Added

- 面板顶栏新增「反馈」，带版本号一键去 GitHub 报问题

### Changed

- 模拟盘改从 npm 获取设置与 FTShare 底座

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.4.1` → `0.5.0`，发布包不再内联设置与 FTShare 底座
- `@dsh-ft/dsh-fft-settings`：`0.5.0`（registry 依赖，此前内联同版本）
- `@dsh-ft/dsh-fft-ftshare`：`0.2.1` → `0.3.0`（改为 registry 依赖）
- `DSH Kline`：`0.4.0-ft.2`（仍内联）

## [0.4.1] - 2026-10-26

### Changed

- K 线改挂原生右侧栏，撤掉浮动 K 入口与首次引导欢迎页

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.4.0` → `0.4.1`，重打发布包，修正 0.4.0 误带 K 线 ft.1
- `DSH Kline`：`0.4.0-ft.1` → `0.4.0-ft.2`

## [0.4.0] - 2026-10-26

### Added

- 模拟盘可独立安装，自带行情与完整 K 线
- 顶栏显示数据源状态：已配置 / 免费 / 无 / 无效
- 行情不可用时给出原因、获取 Key 与重试入口
- 交易日历降级时面板标出，恢复后自动切回
- 额度用尽或未配置 Key 时给出明确提示
- 顶栏数据源徽标在取数失败时标明原因

### Changed

- 包名迁移到 `@dsh-ft/dsh-fft-paper-trading`
- 免费行情来源标为「FTShare 免费版」，不再冒充实时价
- 只在连续竞价取行情，免费额度不再被 5 秒轮询烧光
- 行情页板块列表改走免费接口，无 Key 也能翻页
- 数据源正常、设置指引与免费档更新时间更清晰
- 期货行情提示与股票用同一套说明
- 插件列表显示「模拟交易」标题，图标与金融工作台一致
- 行情额度用尽提示改为「免费额度已用尽」，并指路 设置 → 金融终端
- 额度恢复口径改为滚动约 24 小时
- 行情提示不再外链注册页，改为指路 设置 → 金融终端
- README 重写为使用者文档，补充安装与行情说明

### Fixed

- 日K收盘报价标为「收盘」，不再冒充现价
- 行情列表翻页提示改为翻页上限
- 合约索引刷新失败不再透出上游接口名
- 上游真停机不再显示成「额度用尽」

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.3.2` → `0.4.0`
- `@dsh-ft/dsh-fft-settings`：`0.4.5` → `0.5.0`，设置页更名为「金融终端」，访问凭据卡标注 FTShare 数据源
- `@dsh-ft/dsh-fft-ftshare`：`0.2.0` → `0.2.1`，额度用尽不再被误判成套餐未开通、不再吞掉配额提示
- `DSH Kline`：`0.4.0` → `0.4.0-ft.1`，随包内联完整 K 线（0.4.1 起前移到 ft.2）

## [0.3.2] - 2026-10-23

### Added

- 账户头新增「资金」，可注资/提款，盈亏不再把入金算成盈利
- 期货复盘补上资金流水，提款上限为可用资金

### Changed

- 交易页只保留一个实心橙的下单按钮，方向和数量并排

### Fixed

- 修正代码后，票面上旧的代码错误提示会自动消失
- 修复打开面板时 `600519.XSHG` 报错，统一显示 `600519.SH`

### Components

- `@ft/dsh-fft-paper-trading`：`0.3.1` → `0.3.2`

## [0.3.1] - 2026-10-23

### Changed

- 自选列表更名为「备选」，交易页与工具摘要同步
- 证券代码统一为「代码.交易所」形式，股票与期货共用同一套标的身份

### Components

- `@ft/dsh-fft-paper-trading`：`0.3.0` → `0.3.1`

## [0.3.0] - 2026-10-23

### Added

- 新增商品期货模拟盘：交易、持仓、订单、复盘四个页签与 8 个 `futures_*` 工具
- 期货按手交易、保证金占用、T+0 平仓，15:30 按收盘价结算并做强平与到期检查
- 交易面板补齐挂单回报、失败重试与陈旧数据提示

### Changed

- 一揽子支持 SH600519 形式与 Excel 引号单元格，预算输入规范化

### Components

- `@ft/dsh-fft-paper-trading`：`0.2.0` → `0.3.0`

## [0.2.0] - 2026-10-23

### Added

- 新增「一揽子」页签：按 CSV 权重一次配股，预览股数、费用与剩余现金后批量下单

### Fixed

- 同一批次重试不会重复下单

### Components

- `@ft/dsh-fft-paper-trading`：`0.1.0` → `0.2.0`

## [0.1.0] - 2026-10-22

### Added

- 模拟盘拆成独立仓库，可单独安装
- 模拟交易、持仓、订单、复盘四个页签与 8 个 `paper_*` 工具
- 行情与交易日历走宿主 `ftshareData`，缺失时降级为手填参考价 + 工作日日历

### Components

- `@ft/dsh-fft-paper-trading`：新增 `0.1.0`

[0.6.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gigaflw/dsh-fft-paper-trading/releases/tag/v0.1.0
