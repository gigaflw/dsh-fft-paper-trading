---
name: dsh-fft-paper-trading-release
description: 用于模拟盘插件对外发版时。不用于日常功能提交，也不用于插件安装验收。
---

# 模拟盘发版

一次发版 = CHANGELOG 段 + 定版提交 + tag；**push tag 之后由 GitHub Actions 构建、测试、发布 npm、创建 GitHub Release**，本地不再打包上传。

## 1 版本与区间

- 区间起点取上一版 CHANGELOG 标题写入的提交：`git log -S '## [X.Y.Z]' --format='%h %s' -- CHANGELOG.md`（结果唯一）；区间内提交 `git log --format='%h %s%n%b' <起点>..HEAD`。
- SemVer：能力新增 minor、修正 patch、不兼容 major；只有用户可感知的改动才发版。
- 定版前 `pnpm run build && pnpm test`。`lib/` 必须随版本一起提交（git / bundle 安装直接读源码树里的构建产物），其中 `lib/client.js` 的版本戳由构建写入。

## 2 CHANGELOG

- 根 `CHANGELOG.md` 是唯一对外变更记录；定版时补齐 `## [X.Y.Z] - YYYY-MM-DD`。
- 功能条目来源是区间内提交正文的 `RN:` 行，按语义分到 Added / Changed / Fixed / Removed，只排序去重、不改写。
- `### Components`：本包版本；settings / ftshare 用 `package.json` 的 registry 范围；kline 用 `release.klineRef`（产物内联的就是它）。
- 文末补 compare 链接；覆盖检查 `git log --grep='^RN: ' <起点>..HEAD`。

## 3 定版与 tag

- 定版提交标题 `release: vX.Y.Z`，`git commit -s`；只改 `package.json`、`CHANGELOG.md` 与版本戳重构建的 `lib/client.js`，正文不写 RN。
- tag 打在定版提交上：`git tag -a vX.Y.Z <sha> -m vX.Y.Z`；已推 tag 不移动、版本号不复用。

## 4 产物（CI 构建）

- 产物由 `.github/workflows/publish.yml` 从 tag 构建：`pnpm install --frozen-lockfile` → `pnpm test` → `node scripts/pack-npm.mjs --kline <clone>`。
- 只有 kline 内联，pin 在 `package.json` 的 `release.klineRef`；settings / ftshare 是 `dependencies` 里的 registry 范围，不进产物。
- 本地预览产物（仅检查，不作为发布物）：`node scripts/pack-npm.mjs --kline ../dsh_kline`，输出到 `releases/`。
- CI 把产物的 sha256 与大小写进 Release 说明，校验时对得上。

## 5 发布

- 镜像：`node scripts/mirror-public.mjs`，按其输出 `git push --force github public:main` 与各 tag（至少 `vX.Y.Z`）。
- push tag 触发 Actions：install → build/test → 打包 → `npm publish`（OIDC trusted publishing，自动 provenance）→ 建/更新 GitHub Release（tgz + 校验值）→ 校验 registry。
- 手动重跑：`gh workflow run publish.yml --repo gigaflw/dsh-fft-paper-trading -f tag=vX.Y.Z`；进度看 `gh run list --repo ...` / `gh run view <id>`。
- **GitLab 通道只用于临时本地调试**：`node scripts/upload.mjs --gitlab`（包注册表 + Release 链接），不进入常态发版。
- 应急（Actions 故障）：`node scripts/upload.mjs --npm` 人工发（需 OTP），再 `--github` 补 Release。

## 6 凭据

- 常态发版不需要任何 npm token：npm 侧走 trusted publisher（GitHub Actions：`gigaflw/dsh-fft-paper-trading` / `publish.yml` / 允许 `npm publish`），OIDC 短时凭据，账号强制 2FA。
- trusted publisher 配置不可编辑，改 workflow 文件名、仓库或结构要 revoke 后重建；新建配置 2 天内必须完成一次成功发布。
- 仓库 `.env` 的 `GITLAB_TOKEN` 只给临时 GitLab 通道用；`gh` 用于 dispatch 与查看 run。
- gitlab `dev` 是保护分支，非快进推送会被拒；由用户自己推。

## 7 校验

- Actions run 全绿；publish 步骤日志有 `+ @dsh-ft/...@X.Y.Z` 与 provenance 行。
- `npm view @dsh-ft/dsh-fft-paper-trading@X.Y.Z version dist.tarball`。
- `gh release view vX.Y.Z --repo gigaflw/dsh-fft-paper-trading --json isDraft,assets`：非 draft、带 tarball，sha256 与 notes 一致。
- public：`git log --oneline -1 public` 与 GitHub `main` 一致；`git tag --points-at <定版 sha>` 含 `vX.Y.Z`，`git status` 干净。

## 8 失败模式

- publish 403 / ENEEDAUTH：trusted publisher 未配、仓库或 workflow 文件名不符、或未勾 `npm publish`（2026-09-03 后新建配置默认只允许 stage publish）。
- verify 报 404：npm 读副本传播延迟，workflow 已轮询；不要据此重发。
- tag 与 `package.json` 版本不符：`release-notes.mjs --tag` 会拒绝，改 tag 或版本后重来。
- kline 前移：改 `release.klineRef` 并把对应 tag 推到 `gigaflw/dsh_kline`，否则 CI clone 失败。
- 同版本重传：npm 拒绝；要换产物就升版本。
