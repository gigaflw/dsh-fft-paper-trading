# Changelog

本文件记录 `@dsh-ft/dsh-fft-paper-trading` 的对外变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[SemVer](https://semver.org/lang/zh-CN/)。

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

[0.5.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gigaflw/dsh-fft-paper-trading/releases/tag/v0.1.0
