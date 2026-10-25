# AGENTS.md

本仓库是 A 股模拟盘插件 **@dsh-ft/dsh-fft-paper-trading** 的独立仓库，既可以独立安装，也可以随 dsh-fft-bundle 一起安装

## 本机环境

- dsh-fft-bundle：`/Users/ben/workspace/dsh-fft-bundle`, 其 AGENTS.md 部分与本仓库共享。最后同步 2026-10-22。改共享规则时两边同步
- DSH 应用：桌面版；profile `~/.dsh/profiles/desktop`
- DSH 源码：`~/workspace/dsh-ft/submodules/deepseek-harness`
- 插件数据：`$DSH_HOME/paper-trading/`（与仓库位置无关）

## Rules
> 与 fft bundle 共享
- 用户可感知的改动在 commit 正文写一行 `RN: <中文一句，用户视角，≤40 字>`；一个提交有多处变化就写多行
- Release note 统一追加到 `docs/releases.md`，按版本号倒序维护：「功能更新」= 发布区间内的 `RN:` 行，「组件更新」= 发生版本变化的包
- bump bundle 版本时同时更新 `docs/releases.md`
- skill 内容精简精确
- skill 的 `description` 只回答「什么时候读」，一句话说清用户要达成的**目标**，不列机制名、文件名、参数、步骤——写细了正文一改就得跟着改；相邻 skill 撞车时补一句「不用于…」划界，同时出现即命中同一类词根（如两个 skill 都写 Feishu）是撞车的主因
- `description` 里不要出现 `: `（YAML 明文标量会被解析成映射，skill 直接从目录消失，且不报错）
- 通过调查 deepseek harness 源码得到的知识，提醒用户是否要更新到相关 skill 中
- 插件中用户可见的 UI 部分禁止大段描述，尽量精简文字
- worktree 一律放 `.worktrees/`，并常驻一个中性复用工作区 `.worktrees/scratch`：`detached HEAD` 停在 `dev` 的最新提交，
  `node_modules` 留着（别再为每个特性重复 `pnpm install`）
  - 开工：`cd .worktrees/scratch && git switch -c feat/<特性>`（`dev` 被主检出占用，这里不能直接 `switch dev`）
  - 收尾：主检出 `git merge --ff-only feat/<特性>`（分支落后就先在 scratch 里 `git rebase dev`），再删该特性分支，
    并在 scratch 里 `git checkout --detach` 交还复用
  - 特性分支只是临时载体，`dev` 是唯一长期分支
- 桌面 DSH 运行时不要反复 build profile 里 `link:` 的客户端插件（热重载会撞上半写文件，使 entry 及同 bundle 插件启动失败）：一批改完再 build 并 ⌘Q 重开，或先拷成 profile 内稳定副本再同步。

## Commits
> 与 fft bundle 共享
- 需要 git commit -s 签名
- 鼓励架构优化重构，先重构，再开发，commit 用 `refactor: ` 前缀
- commit title 前缀用 `type: `, 可用 type 包括：feat/skills/docs/refactor/fix/chore/test
- 如果有关一个特定功能，用`type(feat-name)`，feat-name 与历史 commit 保持统一
- feat/skills/refactor/fix 改动单独提交
- docs 改动如果是一个新功能的设计文档，需要单独提交，否则允许合并到对应的功能commit中
- skills 改动如果只修改了一个skill 需 `skills(name): `
- chore 改动包含 .gitignore, AGENTS.md 等非功能改动
- 定版提交标题用 `release: vX.Y.Z`，不套 `type:` 前缀；正文不写 `RN:`

## 文档
> 与 fft bundle 共享
- `docs/` 只放本包知识：设计（`design.md`）、MVP 范围、进度、UI 预览与调研；不引用主仓或其他子仓的文档，跨仓出处用文字说明
- 调查默认不归档：除非用户明确要求留档，结论直接用于决策或落地，不写进 `docs/investigation/`
- 根 `README.md` 只写简介 + 使用方式 + 开发方式；实现细节写进 `docs/`
