# AGENTS.md

本仓库是 A 股模拟盘插件 **@dsh-ft/dsh-fft-paper-trading** 的独立仓库，既可以独立安装，也可以随 dsh-fft-bundle 一起安装。

## 本机环境

- 插件数据：`$DSH_HOME/paper-trading/`

## 测试位置

- 测**本机安装实例**用 `tests/e2e/cdp.mjs`：它只连 9023 调试口，真窗口 + profile 里的安装版
  `lib/client.js` + 真后端 + 真账本，不读本仓 `lib/`，所以改了源码但没同步进 profile 也不会测错对象。
  驱动实例前先把账本 `paper_ledger { action: "backup" }` 备份，测完 `restore`。
- 测**本仓源码**用 `tests/e2e/` 下其余脚本（`flow-fake.mjs` / `ui-panel.mjs` / `offline-*.mjs`）：
  它们读本仓 `lib/`，需先 `pnpm build`，不适用于安装实例验收。
- `flow-fake.mjs` 会替换窗口的 `window.fetch`，中途失败会打瘫整个桌面端 RPC；只想看安装实例
  的 UI，别用它。

## 共享工作区

同一工作区可能同时有别的会话在改文件。动手前先看 `git status --porcelain`：

- 别人在途的未跟踪/已暂存文件不要改、不要提交；提交只带本次路径（`git commit -- <paths>`），索引里别人的改动先 `git restore --staged`，否则裸 `git commit` 会顺带带走。
- 「目前的变更」= 上一次 tag 之后的提交；工作区里有别人的未提交改动时先问清归属，不要把它们算进本次改动。

## 发版与推送

被问到 bump / 发版 / 推送时，先用一条命令取齐事实，直接给结论，不要先翻 `ft-release` 或推演流程：

```bash
git status -sb; git log --oneline -6; git branch -vv; git tag --sort=-v:refname | head -5
git ls-remote --heads --tags gitlab | tail -6; git ls-remote --heads --tags github | tail -6
node scripts/mirror-public.mjs --dry-run | sed -n '/^next (manual)/,$p'   # GitHub main / tag 的推送命令，含 sha
curl -s https://registry.npmjs.org/@dsh-ft%2Fdsh-fft-paper-trading \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['dist-tags'],sorted(d['versions']))"
```

- **更新版本**：改 `package.json` → `CHANGELOG.md` 加版本段 → `pnpm run build`（`lib/client.js` 里的版本戳）→ 提交 `release: vX.Y.Z`。不打 tag、不推送、不跑全量 `pnpm test`；全测只在当次要发版时跑。
- **推送**：GitLab 直推 `dev` 与要落的 tag；GitHub 用上面 `--dry-run` 打印的 `next` 块，不手算 sha。GitHub 只有 tag 触发 `publish.yml`（test → pack（拉 dsh_kline）→ npm OIDC → Release 页 + tarball + sha256），`main` 与 GitLab 都不跑 CI。
- **回答只给四项**：命令、远端差在哪（哪个分支/tag 落后）、会触发什么、不可逆与失败点。流程本身看工作区 skill `ft-release`，不重抄。
- **公开包, 发布必须 ben 本人执行**: 本包在 npm 上是公开的, 版本一旦 publish 不可撤回、同版本不可重发。
  agent 只做: 改版本与 CHANGELOG、构建、`pack-npm` 产出与自检、打印推送与 `gh` 命令, **不执行**
  `git push`、`gh` 与 `npm publish`。

## kline 版本联动（发布必看）

本包对外发布时内联 `@ftshare-lab/dsh-kline`,并在发布 manifest 里把它声明成**精确版本**。所以:

- kline 版本由 `package.json` 的 `release.klineRef` 决定, `publish.yml` 按该 ref 从 `gigaflw/dsh_kline` clone
  构建。ref 形如 `vX.Y.Z-ft.N`——**不是上游 `FTShare-Lab/dsh_kline` 的 tag**:工作台需要的三项集成
  (图表挂进宿主面板、画布图表面板 `ftCanvas.panel.body`、本包的 `paperTrading.kline` 槽位)只活在 fork
  的 FT 构建里, 钉上游 tag 会让本包面板的 K 线回落到内置 SVG 简图。
- fork 的 tag 必须先存在且已推送, 否则 CI 的 clone 直接失败。
- 组合包 `@ft/dsh-fft-bundle` 的 kline 边与这里的 `klineRef` 必须同版本, 否则它的 `pack-tarball` 内联互检
  会拒绝打包。顺序是 **kline 先出 FT 构建 → 本包升版本发布 → bundle 再发**。
- 发布前确认: `node scripts/pack-npm.mjs --kline <fork checkout>` 产物内联的 kline 版本与 `klineRef` 一致。

## 需求表

- 开发完一个功能点后，提醒用户是否要更新远端飞书需求表。
- 回填口径：已发版的行只填「完成版本」并追加进展；X.Y.0 另立「X.Y.0 发版」节点行（分类=重要节点）。写表命令见工作区 skill `ft-feishu-ledger`，此处不重复。

## 文档

- 根 README 是中英对照对：`README.md`（英文）+ `README.zh.md`（中文），H1 下各带语言切换行。改任意一侧必须在同一次改动里同步另一侧；`pnpm test` 会校验配对、切换行与结构对齐（标题层级、代码块逐字节一致、列表/表格/链接一一对应），也可单独跑 `pnpm run verify:translation`。