# AGENTS.md

本仓库是 A 股模拟盘插件 **@dsh-ft/dsh-fft-paper-trading** 的独立仓库，既可以独立安装，也可以随 dsh-fft-bundle 一起安装。

## 本机环境

- 插件数据：`$DSH_HOME/paper-trading/`

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

## 需求表

- 开发完一个功能点后，提醒用户是否要更新远端飞书需求表。
- 回填口径：已发版的行只填「完成版本」并追加进展；X.Y.0 另立「X.Y.0 发版」节点行（分类=重要节点）。写表命令见工作区 skill `ft-feishu-ledger`，此处不重复。

## 文档

- 根 README 是中英对照对：`README.md`（英文）+ `README.zh.md`（中文），H1 下各带语言切换行。改任意一侧必须在同一次改动里同步另一侧；`pnpm test` 会校验配对、切换行与结构对齐（标题层级、代码块逐字节一致、列表/表格/链接一一对应），也可单独跑 `pnpm run verify:translation`。