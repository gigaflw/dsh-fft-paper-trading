#!/usr/bin/env node
/**
 * Print one release's notes: the CHANGELOG section for the version, plus the
 * artifact checksum when a tarball is supplied.
 *
 * The release workflow and `scripts/upload.mjs` both use this so a GitHub
 * Release always carries the same text and the same verification value, no
 * matter which path created it.
 *
 * Usage:
 *   node scripts/release-notes.mjs [options]
 *
 * Options:
 *   --version <X.Y.Z>   Version (default: package.json version)
 *   --tag <vX.Y.Z>      Assert the tag matches the version; fails otherwise
 *   --artifact <path>   Tarball whose sha256 and size are appended
 *   -h, --help          Print this help
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at === -1 ? fallback : argv[at + 1] }

if (argv.includes('-h') || argv.includes('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('/**')[1].replace(/^ \* ?/gm, ''))
  process.exit(0)
}

const fail = message => { console.error(`release-notes: ${message}`); process.exit(1) }

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const version = option('version', manifest.version)
const tag = option('tag', undefined)
if (tag !== undefined && tag !== `v${version}`) {
  fail(`tag ${JSON.stringify(tag)} does not match package.json version ${version}`)
}

const changelogPath = join(repoRoot, 'CHANGELOG.md')
if (!existsSync(changelogPath)) fail('CHANGELOG.md is missing')
const lines = readFileSync(changelogPath, 'utf8').split('\n')
const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
if (start === -1) fail(`CHANGELOG.md has no "## [${version}]" section`)
let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
if (end === -1) end = lines.findIndex((line, index) => index > start && /^\[[0-9]/u.test(line))
if (end === -1) end = lines.length
const body = lines.slice(start + 1, end).join('\n').trim()
if (body === '') fail(`CHANGELOG.md section ${version} is empty`)

let out = body
const artifact = option('artifact', undefined)
if (artifact !== undefined) {
  const path = resolve(repoRoot, artifact)
  if (!existsSync(path)) fail(`artifact not found: ${path}`)
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
  const mb = (statSync(path).size / 1024 / 1024).toFixed(1)
  out += `\n\n### 产物校验\n\n- \`${basename(path)}\`\n- sha256：\`${sha}\`\n- 大小：${mb} MB`
}
console.log(out)
