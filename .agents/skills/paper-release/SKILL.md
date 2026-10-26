---
name: paper-release
description: 用于模拟盘插件对外发版时。不用于日常功能提交，也不用于插件安装验收。
---

# 模拟盘发版

一次发版 = CHANGELOG 段 + 定版提交 + tag + 自包含产物 + 三条通道上传 + 校验。命令由脚本承担，本文只定顺序与判据。

## 1 版本与区间

- 定版前 `pnpm run build`，`git status` 不得有 `lib/` 漂移。
- 区间起点取上一版 CHANGELOG 标题写入的提交：`git log -S '## [X.Y.Z]' --format='%h %s' -- CHANGELOG.md`（结果唯一）。
- 区间内提交：`git log --format='%h %s%n%b' <起点>..HEAD`。
- SemVer：能力新增 minor、修正 patch、不兼容 major。
- 只有用户可感知的改动才发版；纯内部脚本/文档改动不发版，随下一次发版带上。

## 2 CHANGELOG

- 根 `CHANGELOG.md` 是唯一对外变更记录；定版时一次性补齐 `## [X.Y.Z] - YYYY-MM-DD`。
- 「功能更新」来源是区间内提交正文的 `RN:` 行，按语义分到 `### Added` / `### Changed` / `### Fixed` / `### Removed`，只排序去重、不改写。
- `### Components` 列版本变化：本包，以及产物内联的 settings / ftshare / kline（版本以 `pack:npm` 输出的 `inlined:` 行为准）。
- 文末补 compare 链接 `[X.Y.Z]: https://github.com/gigaflw/dsh-fft-paper-trading/compare/vA...vB`，首版用 `releases/tag`。
- 覆盖检查：`git log --grep='^RN: ' <起点>..HEAD` 与区间内 feat/fix 提交逐条对账；缺 RN 且用户可感知时补回该提交。

## 3 定版与 tag

- 定版提交标题 `release: vX.Y.Z`，只改 `package.json` 与 `CHANGELOG.md`，正文不写 RN；`git commit -s`。
- tag 打在定版提交上：`git tag -a vX.Y.Z <sha> -m vX.Y.Z`；已推 tag 不移动、版本号不复用。
- 需要重打产物或补文档时发新版本号，不覆盖同版本（npm 同版本不可覆盖）。

## 4 产物

- `pnpm run build && pnpm run pack:npm` → `releases/dsh-ft-dsh-fft-paper-trading-<ver>.tgz`。
- 自包含：内联 settings / ftshare / kline；`pack:npm` 会拒绝夹带 `AGENTS.md`、`.agents/`、`docs/`、`tests/`、`scripts/`、`.env` 等内部路径。
- 记下输出的 sha256，与 Release 说明里的校验值一致。

## 5 分发

- GitLab：`node scripts/upload.mjs --gitlab`（包注册表 + Release 资产链接；幂等，重跑只补链接）。
- GitHub：`node scripts/upload.mjs --github`（Release 附件；缺 Release 时先建 draft，上传后自动发布）。GitHub 代码仓由 `public` 分支承载，先 `node scripts/mirror-public.mjs`，按其输出的 `git push --force github ...` 推 `main` 与各版本 tag。
- npm：`node scripts/upload.mjs --npm`（发布 `@dsh-ft/dsh-fft-paper-trading`，同版本已存在会拒绝）。
- 网络慢统一加 `HTTPS_PROXY=http://127.0.0.1:7890`；脚本继承调用方环境。
- public 侧不得出现 `docs/`、`AGENTS.md`、`.agents/` 及本地脚本。

## 6 凭据

- 仓库 `.env`（已 gitignore）：`GITLAB_URL`、`GITLAB_TOKEN`（项目 access token，`api` scope）。
- npm 凭据按调用方环境传入，例如 `NPM_CONFIG_USERCONFIG`；账号 `clrstn2830h`（npm org `@dsh-ft` owner）。
- gitlab `dev` 是保护分支，非快进推送会被拒；需要 force 时先确认权限。

## 7 校验

- `git tag --points-at <定版 sha>` 含 `vX.Y.Z`；`git status` 干净。
- `tar -tzf` 产物无内部路径，内联组件版本与 `### Components` 一致。
- GitHub：`gh release view vX.Y.Z --repo gigaflw/dsh-fft-paper-trading --json isDraft,assets`，`isDraft` 为 false 且带 tarball。
- GitLab：`/-/releases` 有该版本且附件指向包注册表。
- npm：`npm view @dsh-ft/dsh-fft-paper-trading@X.Y.Z version`。
- public：`git log --oneline -1 public` 与 GitHub `main` 一致。

## 8 失败模式

- 保护分支拒 force push：先确认权限，或改用 merge，不要硬推。
- GitHub 建出 draft 就当发完：`upload.mjs` 会自动 publish，手建时要自己点。
- 大文件直连超时：走代理重跑，脚本幂等。
- npm token 过期：重新 `npm login --auth-type=web` 或换 userconfig 后重跑。
- 同版本重传：npm 拒绝、GitLab 保留旧包只补链接；要换产物就升版本。
