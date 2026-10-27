#!/usr/bin/env node
/**
 * 把本包同步成 desktop profile 里的**稳定副本**，而不是 link: 到本仓库。
 *
 * 背景：profile 里 link: 到仓库时，任何 `pnpm build` 都会触发 DSH 客户端模块
 * 热重载；撞上写入中间态会让整个 entry 加载失败（见工作区根 AGENTS.md）。同步到 profile
 * 内的 vendor 目录后，仓库里怎么改都不影响正在运行的应用；更新时重跑本脚本
 * 并让应用 ⌘Q 重开。
 *
 * 用法：
 *   node scripts/sync-profile.mjs [--profile-dir ~/.dsh/profiles/desktop]
 *   （默认 profile 见 DSH_PROFILE_DIR，否则 ~/.dsh/profiles/desktop）
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const args = process.argv.slice(2)
const profileDir = resolve(
  args.includes('--profile-dir') ? args[args.indexOf('--profile-dir') + 1] : (process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh/profiles/desktop')),
)
if (!existsSync(join(profileDir, 'package.json'))) throw new Error('找不到 desktop profile：' + profileDir)

const pkg = { name: '@dsh-ft/dsh-fft-paper-trading', src: pkgRoot }
const vendorRoot = join(profileDir, 'vendor')
const target = join(vendorRoot, pkg.name.split('/').pop())

mkdirSync(vendorRoot, { recursive: true })
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const file of ['package.json', 'cordis.patch.yml', 'README.md']) {
  if (existsSync(join(pkg.src, file))) cpSync(join(pkg.src, file), join(target, file))
}
cpSync(join(pkg.src, 'lib'), join(target, 'lib'), { recursive: true })
console.log('copied', pkg.name, '->', target)

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const deps = manifest.dependencies ?? (manifest.dependencies = {})
const bundles = manifest.dsh?.profile?.bundles ?? []
deps[pkg.name] = 'link:' + target
if (!bundles.includes(pkg.name)) bundles.push(pkg.name)

const link = join(profileDir, 'node_modules', pkg.name)
rmSync(link, { force: true, recursive: true })
mkdirSync(dirname(link), { recursive: true })
symlinkSync(target, link)

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('profile updated:', manifestPath)
console.log('bundles:', bundles.join(', '))
console.log('现在可以 ⌘Q 完全重开 DSH；仓库里的 build 不再影响运行中的应用。')
