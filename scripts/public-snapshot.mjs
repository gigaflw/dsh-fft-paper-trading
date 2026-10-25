#!/usr/bin/env node
/**
 * Build the public snapshot history that the GitHub repository carries.
 *
 * The public repo ships the plugin, its tests and the release notes only. The
 * design notes, agent instructions and the local profile helper stay internal,
 * so a snapshot drops every `docs/` file except `docs/releases.md`, drops
 * `AGENTS.md` and `scripts/sync-profile.mjs`, and removes the matching npm
 * script from the manifest. Everything else (source, build output, tests,
 * patch, icon, locale, lockfile) is copied from the source ref untouched.
 *
 * Nothing touches the worktree or the real index: the tree is assembled in a
 * scratch index and committed onto the local `public` branch. Pushing and
 * tagging the public remote stay manual, and the internal dev history is never
 * rewritten.
 *
 * Usage:
 *   node scripts/public-snapshot.mjs [--ref <ref>] [--message <text>]
 *   node scripts/public-snapshot.mjs --help
 *
 * After it runs:
 *   git push github public:main
 *   git push github <snapshot sha>:refs/tags/vX.Y.Z   # release snapshot only
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}

if (argv.includes('-h') || argv.includes('--help')) {
  const header = execFileSync('sed', ['-n', '1,30p', fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  console.log(header.replace(/^\/\*\*?| \*\/?/gm, '').replace(/^ /gm, ''))
  process.exit(0)
}

const BASE = option('ref', 'HEAD')
const BRANCH = 'public'
const MESSAGE = option('message', 'chore: public snapshot')
const ALWAYS_EXCLUDED = ['AGENTS.md', 'scripts/sync-profile.mjs']
const KEPT_DOCS = new Set(['docs/releases.md'])
const DROPPED_SCRIPTS = ['sync-profile']

const git = (args, options = {}) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', ...options })
const fail = message => { throw new Error(`public-snapshot: ${message}`) }

const gitDir = git(['rev-parse', '--absolute-git-dir']).trim()
const indexPath = join(gitDir, `public-snapshot.${process.pid}.index`)
const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath }

try {
  git(['read-tree', BASE], { env: indexEnv })

  const paths = git(['ls-tree', '-r', '--name-only', BASE]).split('\n').filter(Boolean)
  if (paths.length === 0) fail(`ref ${BASE} has no files`)

  const excluded = paths.filter(path =>
    ALWAYS_EXCLUDED.includes(path)
    || (path.startsWith('docs/') && !KEPT_DOCS.has(path)))
  const kept = paths.filter(path => !excluded.includes(path))
  if (!kept.includes('docs/releases.md')) fail(`docs/releases.md is missing from ${BASE}`)
  if (!kept.includes('README.md')) fail(`README.md is missing from ${BASE}`)

  for (let at = 0; at < excluded.length; at += 200) {
    git(['update-index', '--force-remove', '--', ...excluded.slice(at, at + 200)], { env: indexEnv })
  }

  const manifest = JSON.parse(git(['show', `${BASE}:package.json`]))
  for (const name of DROPPED_SCRIPTS) delete manifest.scripts?.[name]
  const blob = git(['hash-object', '-w', '--stdin'], { input: `${JSON.stringify(manifest, null, 2)}\n` }).trim()
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},package.json`], { env: indexEnv })

  let parent
  try {
    parent = git(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).trim()
  } catch {
    parent = undefined
  }
  const tree = git(['write-tree'], { env: indexEnv }).trim()
  const commitArgs = ['commit-tree', tree]
  if (parent !== undefined) commitArgs.push('-p', parent)
  commitArgs.push('-m', MESSAGE)
  const commit = git(commitArgs).trim()
  git(['update-ref', `refs/heads/${BRANCH}`, commit])

  const droppedDocs = excluded.filter(path => path.startsWith('docs/')).length
  console.log(`public snapshot ${commit.slice(0, 12)} on ${BRANCH}${parent === undefined ? ' (initial)' : ` (parent ${parent.slice(0, 12)})`}`)
  console.log(`kept ${kept.length} paths; excluded ${excluded.length} (${droppedDocs} docs, ${ALWAYS_EXCLUDED.length} internal)`)
  console.log(`removed npm script: ${DROPPED_SCRIPTS.join(', ')}`)
  console.log('next (manual):')
  console.log(`  git push github ${BRANCH}:main`)
  console.log(`  git push github ${commit}:refs/tags/vX.Y.Z   # release snapshot only`)
} finally {
  rmSync(indexPath, { force: true })
}
