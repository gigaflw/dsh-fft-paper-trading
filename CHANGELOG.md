# Changelog

本文件记录 `@dsh-ft/dsh-fft-paper-trading` 的对外变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[SemVer](https://semver.org/lang/zh-CN/)。

## [0.8.1] - 2026-11-23

共享底座下限提升：FTShare 出站开始携带 dsh 渠道归因参数，网关访问日志可按渠道统计插件的取数流量。

### Changed

- 依赖下限提升到 `@dsh-ft/dsh-fft-settings ^0.7.3` 与 `@dsh-ft/dsh-fft-ftshare ^0.4.4`，安装时至少会取到带渠道归因的版本。

## [0.8.0] - 2026-11-23

一个插件实例内可以有多个股票账户：各自独立账本与复盘，面板顶栏切换，对比页按收益排名；「隐藏」升级为可恢复的「归档」。

### Added

- 股票账户支持多账户：顶栏下拉新建与切换，各账户独立记账、复盘与导出，「对比」页把净值曲线归一化叠加并按收益排名
- 每个账户有整页「笔记」：一整块自由改写的文本，自动保存，仅本人可读写，模型没有入口
- 模型工具可显式指定账户（名字或 id）下单、复盘与查询；不传仍是默认账户
- 账本恢复工具支持任意股票账户，不再只限于默认账户与期货账户
- 交易列与行情/K 线栏可拖动调宽、可折叠，K 线高度支持自动/高/满三档

### Changed

- 面板「隐藏」改名为「归档」：一键归档即从面板与对比页收起并冻结交易与资金操作，数据保留、可随时恢复，恢复后保留归档前的锁定状态
- 复盘周期切换只刷新复盘内容，不再重载账户或清空票据预览
- 同一 `requestId` 携带不同委托参数时明确报错，不再静默返回旧单
- 期货账户名称固定，不再允许改名

### Fixed

- 期货账户的「锁定」真正生效：锁定后拒绝下单、出入金与重置，已有挂单仍可成交或撤销
- 修复自定义主题（声明浅色、实际深色）下交易页选中按钮文字看不清
- 左侧栏入口跟随 DSH 界面语言，英文界面显示 Paper Trading

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.7.3` → `0.8.0`
- `DSH Kline`：未变

## [0.7.3] - 2026-11-16

README 的 API Key 申请入口改为 FTShare 落地页，并补齐 UTM 归因；运行代码不变。

### Changed

- README（中/英）的申请地址改为 `https://ftai.chat/ftshare?utm_source=dsh-fft&utm_medium=AI&utm_campaign=dsh`

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.7.2` → `0.7.3`
- `DSH Kline`：未变

## [0.7.2] - 2026-11-13

发布产物不再内联 K 线：K 线改为 npm 依赖，安装后的功能与外观不变，包体积从约 1 MB 降到约 120 KB。

### Changed

- `@ftshare-lab/dsh-kline` 改为 registry 依赖（下界 `>=0.6.11`），不再复制进产物、不再声明 `bundledDependencies`
- 发布流水线不再 clone 上游 K 线仓；`package.json` 的 `release.klineRef` 移除，K 线版本由依赖范围表达

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.7.1` → `0.7.2`
- `DSH Kline`：不再随包内联，改为依赖 `>=0.6.11`

## [0.7.1] - 2026-11-13

### Changed

- 面板 K 线槽位改由 K 线上游宿主契约填充：客户端向已安装的 K 线请求 `klinePanels.mount('paperTrading.kline')`，
  不再依赖 FT 定制的 K 线构建；没有该契约的旧版 K 线仍回落到内置简图
- 随包内联的 `DSH Kline` 由 `v0.6.7-ft.1` 升到上游 `v0.6.11`

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.7.0` → `0.7.1`
- `DSH Kline`：`v0.6.7-ft.1` → `v0.6.11`（上游 tag，不再有 `-ft` 构建）

## [0.7.0] - 2026-11-13

设置与 FTShare 两个底座都发布了新版本，本次跟随升级，用户可见的变化集中在设置页与取数目录。

### Added

- 设置页在首次启动时于左下角提示获取免费的 FTShare API Key：不盖遮罩、不抢焦点，12 秒后自动淡出
  （鼠标悬停暂停），设备级只出现一次
- 设置页「金融终端」分区显示 FT 徽标图标，不再落到宿主的通用齿轮；分区名跟随界面语言
  （中文「金融终端」、其它「FT Terminal」）

### Changed

- 「获取 API Key」与升级订阅入口带 `utm_source=dsh-fft`，站点点位据此区分来自插件的访问
- FTShare 随包接口目录 250 → 256 条：新增全市场公告与定期报告的文件下载、股指期货与指数深度、
  上金所现货品种主档；这六条此前只能被 `ftshare_status` 报告为「与随包不一致」，无法直调
- `ft:services` 提示词改为点名真正挂载的 dsh-kline 与 `ftshare_*`：原先点名的 `cockpit_*` 与
  `factor-intake-standard` 已从组合包下线，点名它们会让模型去找装不上的工具

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.6.3` → `0.7.0`
- `@dsh-ft/dsh-fft-settings`：`0.5.1` → `0.7.0`（registry 依赖）
- `@dsh-ft/dsh-fft-ftshare`：`0.4.0` → `0.4.2`（registry 依赖）
- `DSH Kline`：`v0.6.7-ft.1`（未变）

## [0.6.3] - 2026-11-06

### Changed

- 内联的 K 线构建前移到 fork 的 v0.6.7-ft.1：首次安装时依赖准备不再占用宿主重连次数，无 Key 时可查看港股与美股日 K
- 发布清单内 `@ftshare-lab/dsh-kline` 的声明由精确版本改为下界（`>=`）：本包只声明 `paperTrading.kline` 槽位、不调用其 API，此后升 K 线不必再等本包发版

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.6.2` → `0.6.3`
- `@dsh-ft/dsh-fft-settings`：`0.5.1`（registry 依赖）
- `@dsh-ft/dsh-fft-ftshare`：`0.4.0`（registry 依赖）
- `DSH Kline`：`v0.6.4-ft.1` → `v0.6.7-ft.1`

## [0.6.2] - 2026-11-05

### Added

- 股票模拟账户初始资金改为 100 万元，重置时可自行指定初始资金（面板「重置」、`account/reset` 的 `initialCash`、`paper_stock_account` 的 `initialCash`）

### Changed

- 盘后、午休与集合竞价时段的市价单不再被拒绝，改为排队到下一交易时段开盘成交；收盘竞价仍拒绝（当天没有后续窗口）。挂单状态显示为「待开盘」并说明顺延时点
- 资金不足的提示给出差额：工具结果写明需多少、可用多少，下单按钮写明还差多少
- 内联的 K 线构建前移到 fork 的 v0.6.4-ft.1：Windows 下不再需要手工指定 Python，启动与 Python 环境升级的修复随插件一起到位

### Components

- `@dsh-ft/dsh-fft-paper-trading`：`0.6.1` → `0.6.2`
- `@dsh-ft/dsh-fft-settings`：`0.5.0`（registry 依赖）
- `@dsh-ft/dsh-fft-ftshare`：`0.4.0`（registry 依赖）
- `DSH Kline`：`v0.4.0-ft.2` → `v0.6.4-ft.1`

## [0.6.1] - 2026-11-03

### Changed

- 跟随 FTShare 底座 0.4.0：面板与交易日历读到的失败说明改为上游原文

### Fixed

- 交易日历不再把上游额度打满：改按自然年取一次并缓存（此前按 `from:to` 精确键缓存、失败不缓存），任意区间与 5 秒 tick 都读同一份内存数据，并发提问共享一次在途请求
- 交易日历失败改为指数退避（1→2→4…上限 10 分钟）并记住失败；配额文案与 401/403 这类重试无用的答案在当个自然日（Asia/Shanghai）内不再重试，之前是固定 60 秒重试，额度耗尽后继续加压
- 上游返回空年份不再被当成「全年无交易日」，按失败处理并回退工作日估算，状态里写明原因

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

[0.8.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.7.3...v0.8.0
[0.6.3]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/v0.6.0...v0.6.1
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
