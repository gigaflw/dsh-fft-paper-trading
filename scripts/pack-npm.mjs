#!/usr/bin/env node
/**
 * Pack @dsh-ft/dsh-fft-paper-trading as a self-contained npm tarball.
 *
 * The published package carries settings, ftshare and kline under its own
 * `node_modules` and lists them in `bundledDependencies`, so a plain
 * `dsh plugin add @dsh-ft/dsh-fft-paper-trading` installs without resolving
 * any git or tarball edge (no `blockExoticSubdeps` switch, no ssh).
 *
 * Usage:
 *   node scripts/pack-npm.mjs [options]
 *
 * Options:
 *   --main <dir>        Main plugin repo (default: ../../dsh-fft-bundle next to this repo)
 *   --kline <dir>       dsh_kline checkout (default: ../dsh_kline)
 *   --kline-ref <ref>   kline git ref to inline (default: v0.4.0-ft.1)
 *   --out <dir>         Output directory (default: tmp/npm-pack)
 *   -h, --help          Print this help
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs'
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

const mainRepo = resolve(option('main', join(repoRoot, '..', '..', 'dsh-fft-bundle')))
const klineRepo = resolve(option('kline', join(repoRoot, '..', 'dsh_kline')))
const klineRef = option('kline-ref', 'v0.4.0-ft.1')
const outDir = resolve(option('out', join(repoRoot, 'tmp', 'npm-pack')))
const staging = join(outDir, 'staging')
const packageDir = join(staging, 'package')

const INTERNAL_SETTINGS = '@dsh-ft/dsh-fft-settings'
const INTERNAL_FTSHARE = '@dsh-ft/dsh-fft-ftshare'
const KLINE = '@ftshare-lab/dsh-kline'

const readManifest = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const fail = message => { throw new Error(`pack-npm: ${message}`) }

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

/** Inline one dependency as its own package directory under the consumer's node_modules. */
function inlinePackage(sourceDir, destDir) {
  const manifest = copyPackageFiles(sourceDir, destDir)
  writeFileSync(join(destDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

function inlineKline(destDir) {
  if (!existsSync(join(klineRepo, '.git'))) fail(`kline checkout not found: ${klineRepo}`)
  mkdirSync(destDir, { recursive: true })
  const tarPath = join(staging, 'kline.tar')
  execFileSync('git', ['-C', klineRepo, 'archive', klineRef, '-o', tarPath])
  const result = spawnSync('tar', ['-xf', tarPath, '-C', destDir], { encoding: 'utf8' })
  if (result.status !== 0) fail(`tar failed: ${result.stderr}`)
  rmSync(tarPath, { force: true })
  const manifest = readManifest(destDir)
  if (manifest.name !== KLINE) fail(`kline archive has unexpected name ${manifest.name}`)
  if (!existsSync(join(destDir, 'lib', 'index.js'))) fail('kline archive has no lib/index.js')
  if (!existsSync(join(destDir, 'view'))) fail('kline archive has no view/')
  return manifest
}

/** Registry dependencies of an inlined package, minus the edges that are inlined. */
function registryDependencies(manifest, inlined) {
  const out = {}
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (inlined.has(name)) continue
    out[name] = range
  }
  return out
}

const paper = readManifest(repoRoot)
for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  if (!existsSync(join(repoRoot, required))) fail(`${required} is missing; run pnpm run build first`)
}
if (!existsSync(join(mainRepo, 'packages', 'dsh-fft-settings', 'package.json'))) fail(`main repo not found: ${mainRepo}`)

rmSync(staging, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })

const settingsManifest = inlinePackage(
  join(mainRepo, 'packages', 'dsh-fft-settings'),
  join(packageDir, 'node_modules', '@dsh-ft', 'dsh-fft-settings'),
)
const ftshareManifest = inlinePackage(
  join(mainRepo, 'packages', 'dsh-fft-ftshare'),
  join(packageDir, 'node_modules', '@dsh-ft', 'dsh-fft-ftshare'),
)
const klineManifest = inlineKline(join(packageDir, 'node_modules', '@ftshare-lab', 'dsh-kline'))

if (settingsManifest.name !== INTERNAL_SETTINGS) fail(`unexpected settings name ${settingsManifest.name}`)
if (ftshareManifest.name !== INTERNAL_FTSHARE) fail(`unexpected ftshare name ${ftshareManifest.name}`)

// The paper package itself: files as declared, manifest rewritten for publishing.
copyPackageFiles(repoRoot, packageDir)

const inlined = new Set([INTERNAL_SETTINGS, INTERNAL_FTSHARE, KLINE])
const merged = {
  ...registryDependencies(settingsManifest, inlined),
  ...registryDependencies(ftshareManifest, inlined),
  ...registryDependencies(paper, inlined),
  [INTERNAL_SETTINGS]: settingsManifest.version,
  [INTERNAL_FTSHARE]: ftshareManifest.version,
  [KLINE]: klineManifest.version,
}
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
  bundledDependencies: [INTERNAL_SETTINGS, INTERNAL_FTSHARE, KLINE],
  peerDependencies: paper.peerDependencies,
  engines: paper.engines,
  dsh: paper.dsh,
}
writeFileSync(join(packageDir, 'package.json'), JSON.stringify(published, null, 2) + '\n')

// pnpm refuses bundledDependencies under the isolated linker; the staging root
// carries the hoisted setting the packed manifest relies on.
writeFileSync(join(staging, 'pnpm-workspace.yaml'), 'packages:\n  - package\n\nnodeLinker: hoisted\n')
const pack = spawnSync('pnpm', ['pack', '--pack-destination', outDir], { cwd: packageDir, encoding: 'utf8' })
if (pack.status !== 0) fail(`pnpm pack failed:\n${pack.stdout ?? ''}${pack.stderr ?? ''}`)
const tarball = readdirSync(outDir).filter(name => name.endsWith('.tgz')).sort().at(-1)
if (tarball === undefined) fail('pnpm pack produced no tarball')

const listing = execFileSync('tar', ['tzf', join(outDir, tarball)], { encoding: 'utf8' }).split('\n')
const required = [
  'package/lib/index.js',
  'package/lib/client.js',
  'package/cordis.patch.yml',
  'package/node_modules/@dsh-ft/dsh-fft-settings/package.json',
  'package/node_modules/@dsh-ft/dsh-fft-ftshare/package.json',
  'package/node_modules/@ftshare-lab/dsh-kline/package.json',
  'package/node_modules/@ftshare-lab/dsh-kline/view/kline.html',
]
for (const path of required) {
  if (!listing.includes(path)) fail(`tarball is missing ${path}`)
}
const bytes = statSync(join(outDir, tarball)).size
const sha = createHash('sha256').update(readFileSync(join(outDir, tarball))).digest('hex')
console.log(`tarball: ${join(outDir, tarball)}`)
console.log(`size:    ${(bytes / 1024 / 1024).toFixed(1)} MB (${listing.length} entries)`)
console.log(`sha256:  ${sha}`)
console.log(`inlined: ${settingsManifest.name}@${settingsManifest.version}, ${ftshareManifest.name}@${ftshareManifest.version}, ${KLINE}@${klineManifest.version}`)
console.log(`registry dependencies: ${Object.keys(merged).filter(name => !inlined.has(name)).join(', ')}`)
console.log(`install: dsh plugin --profile <name> add ${join(outDir, tarball)}`)
