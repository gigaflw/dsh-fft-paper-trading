#!/usr/bin/env node
/**
 * Pack @dsh-ft/dsh-fft-paper-trading as an npm tarball.
 *
 * Every dependency resolves from npm: the manifest declares settings, ftshare
 * and kline, and `dsh plugin add @dsh-ft/dsh-fft-paper-trading` installs the
 * whole stack from the registry — no git or tarball edge (no
 * `blockExoticSubdeps` switch, no ssh) and nothing copied into the tarball.
 *
 * Usage:
 *   node scripts/pack-npm.mjs [options]
 *
 * Options:
 *   --out <dir>         Archive directory for the tarball (default: releases/)
 *   -h, --help          Print this help
 *
 * The tarball is archived under `releases/` (git-ignored build output); only
 * the staging tree lives in `build/`. The published content is the package
 * itself: the packer asserts the archive carries no `node_modules/` at all.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at === -1 ? fallback : argv[at + 1] }

if (argv.includes('-h') || argv.includes('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('/**')[1].replace(/^ \* ?/gm, ''))
  process.exit(0)
}

const outDir = resolve(option('out', join(repoRoot, 'releases')))
const workDir = join(repoRoot, 'build', 'npm-pack')
const staging = join(workDir, 'staging')
const packageDir = join(staging, 'package')
const packDir = join(workDir, 'pack')

const INTERNAL_SETTINGS = '@dsh-ft/dsh-fft-settings'
const INTERNAL_FTSHARE = '@dsh-ft/dsh-fft-ftshare'
const KLINE = '@ftshare-lab/dsh-kline'

const readManifest = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const fail = message => { throw new Error(`pack-npm: ${message}`) }

const paper = readManifest(repoRoot)

/** Expand one-level globs (`locale/*.json`) in a manifest `files` list. */
function expandFilesEntries(sourceDir, entries) {
  const out = []
  for (const entry of entries) {
    if (!entry.includes('*')) {
      out.push(entry)
      continue
    }
    const dir = dirname(entry)
    const pattern = basename(entry)
    const regex = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    let names = []
    try {
      names = readdirSync(join(sourceDir, dir))
    } catch {
      fail(`files entry ${JSON.stringify(entry)} points at a missing directory in ${sourceDir}`)
    }
    for (const name of names) {
      if (regex.test(name)) out.push(dir === '.' ? name : join(dir, name))
    }
  }
  return out
}

/** Copy one package's `files` entries into `dest`, skipping VCS and installed trees. */
function copyPackageFiles(sourceDir, destDir) {
  const manifest = readManifest(sourceDir)
  mkdirSync(destDir, { recursive: true })
  const declared = Array.isArray(manifest.files) && manifest.files.length > 0
    ? manifest.files.filter(entry => typeof entry === 'string' && !entry.startsWith('!'))
    : ['lib', 'README.md', 'package.json']
  const entries = expandFilesEntries(sourceDir, declared)
  for (const entry of entries) {
    const from = join(sourceDir, entry)
    if (!existsSync(from)) fail(`${manifest.name}: files entry ${JSON.stringify(entry)} is missing in ${sourceDir}`)
    const to = join(destDir, entry)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, {
      recursive: true,
      dereference: true,
      filter: path => !path.split(/[\\/]/).includes('node_modules') && !path.split(/[\\/]/).includes('.git'),
    })
  }
  // The manifest is rewritten by the caller; keep it until then.
  if (!existsSync(join(destDir, 'package.json'))) {
    writeFileSync(join(destDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  return manifest
}

/** Registry dependencies declared by the paper manifest. */
function registryDependencies(manifest) {
  return { ...(manifest.dependencies ?? {}) }
}

// lib/ is a build output and stays out of git, so packing builds it here: a
// fresh clone has no lib/, and the local internal channel has no CI behind it
// to catch a stale one.
execFileSync('pnpm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })

for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  if (!existsSync(join(repoRoot, required))) fail(`${required} is missing after pnpm run build`)
}

// Settings and ftshare are published packages: the tarball carries the ranges
// this manifest declares, and npm resolves them when the plugin is installed.
// No local checkout of their source repository is needed to build a release.
const settingsRange = paper.dependencies?.[INTERNAL_SETTINGS]
const ftshareRange = paper.dependencies?.[INTERNAL_FTSHARE]
if (typeof settingsRange !== 'string' || settingsRange === '') {
  fail(`package.json dependencies must declare ${INTERNAL_SETTINGS}`)
}
if (typeof ftshareRange !== 'string' || ftshareRange === '') {
  fail(`package.json dependencies must declare ${INTERNAL_FTSHARE}`)
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })

// The paper package itself: files as declared, manifest rewritten for publishing.
copyPackageFiles(repoRoot, packageDir)

// A lower bound, not an exact pin. This package never calls kline's API: it
// only names the `paperTrading.kline` slot that kline's client fills, so any
// build at or above the one it was tested with works, and a kline release does
// not force this package to publish again.
const merged = registryDependencies(paper)
const published = {
  name: paper.name,
  version: paper.version,
  description: paper.description,
  type: paper.type,
  main: paper.main,
  types: paper.types,
  license: paper.license,
  author: paper.author,
  homepage: paper.homepage,
  repository: paper.repository,
  keywords: paper.keywords,
  icon: paper.icon,
  exports: paper.exports,
  files: paper.files,
  dependencies: merged,
  peerDependencies: paper.peerDependencies,
  engines: paper.engines,
  dsh: paper.dsh,
}
writeFileSync(join(packageDir, 'package.json'), JSON.stringify(published, null, 2) + '\n')

// pnpm refuses bundledDependencies under the isolated linker; the staging root
// carries the hoisted setting the packed manifest relies on.
writeFileSync(join(staging, 'pnpm-workspace.yaml'), 'packages:\n  - package\n\nnodeLinker: hoisted\n')
rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir, { recursive: true })
const pack = spawnSync('pnpm', ['pack', '--pack-destination', packDir], { cwd: packageDir, encoding: 'utf8' })
if (pack.status !== 0) fail(`pnpm pack failed:\n${pack.stdout ?? ''}${pack.stderr ?? ''}`)
const produced = readdirSync(packDir).filter(name => name.endsWith('.tgz'))
if (produced.length !== 1) fail(`pnpm pack produced ${produced.length} tarballs in ${packDir}`)

// Archive the release artifact next to its siblings; the version in its name
// keeps every release downloadable while re-packing the same version replaces
// the local copy.
mkdirSync(outDir, { recursive: true })
const tarballPath = join(outDir, produced[0])
renameSync(join(packDir, produced[0]), tarballPath)

const listing = execFileSync('tar', ['tzf', tarballPath], { encoding: 'utf8' }).split('\n')
const required = [
  'package/lib/index.js',
  'package/lib/client.js',
  'package/cordis.patch.yml',
]
for (const path of required) {
  if (!listing.includes(path)) fail(`tarball is missing ${path}`)
}
// Nothing is bundled: every dependency resolves from the registry, so a
// `node_modules/` entry would shadow the published package it should install.
const bundledPaths = listing.filter(path => path.startsWith('package/node_modules/'))
if (bundledPaths.length > 0) fail(`tarball carries bundled dependencies: ${bundledPaths.slice(0, 5).join(', ')}`)
// Settings and ftshare resolve from npm: a bundled copy would shadow the
// published package and drift from the declared range.
const bundledInternal = listing.filter(path => path.startsWith('package/node_modules/@dsh-ft/'))
if (bundledInternal.length > 0) fail(`tarball bundles settings/ftshare: ${bundledInternal.slice(0, 5).join(', ')}`)
// Read the shipped manifest back instead of trusting the staging tree.
const shipped = JSON.parse(execFileSync('tar', ['-xOzf', tarballPath, 'package/package.json'], { encoding: 'utf8' }))
const klineRange = paper.dependencies?.[KLINE]
if (typeof klineRange !== 'string' || klineRange === '') fail(`package.json dependencies must declare ${KLINE}`)
for (const [name, range] of [[INTERNAL_SETTINGS, settingsRange], [INTERNAL_FTSHARE, ftshareRange], [KLINE, klineRange]]) {
  const actual = shipped.dependencies?.[name]
  if (actual !== range) fail(`tarball dependency ${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(range)}`)
}
if (shipped.bundledDependencies !== undefined) {
  fail(`tarball declares bundledDependencies ${JSON.stringify(shipped.bundledDependencies)}; nothing is inlined any more`)
}
// Internal paths must never reach a published artifact: the npm files list and
// the inlined packages are the only allowed sources, so a hit here means the
// manifest or the inliner picked up something it should not ship.
const FORBIDDEN = [
  /^package\/AGENTS\.md$/u,
  /^package\/\.agents\//u,
  /^package\/docs\//u,
  /^package\/tests\//u,
  /^package\/scripts\//u,
  /^package\/\.env$/u,
]
const leaked = listing.filter(path => FORBIDDEN.some(pattern => pattern.test(path)))
if (leaked.length > 0) fail(`tarball carries internal paths: ${leaked.slice(0, 5).join(', ')}`)

const bytes = statSync(tarballPath).size
const sha = createHash('sha256').update(readFileSync(tarballPath)).digest('hex')
console.log(`tarball: ${tarballPath}`)
console.log(`size:    ${(bytes / 1024 / 1024).toFixed(1)} MB (${listing.length} entries)`)
console.log(`sha256:  ${sha}`)
console.log(`registry: ${INTERNAL_SETTINGS}@${settingsRange}, ${INTERNAL_FTSHARE}@${ftshareRange}, ${KLINE}@${klineRange}`)
console.log(`install: dsh plugin --profile <name> add ${tarballPath}`)
