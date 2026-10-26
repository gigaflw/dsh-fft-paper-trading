#!/usr/bin/env node
/**
 * Mirror the internal history onto the `public` branch that the GitHub
 * repository carries.
 *
 * The public repo ships the plugin, its tests and the release notes only. Design
 * notes, agent instructions and the local profile helper stay internal, so every
 * internal commit is replayed with the same tree minus `docs/` (except
 * `docs/releases.md`), minus `AGENTS.md` and `scripts/sync-profile.mjs`, and with
 * the `sync-profile` npm script removed from the manifest. Message, author,
 * committer and dates are byte-for-byte the internal ones, so GitHub shows the
 * real commit history instead of one squashed snapshot. A commit that only
 * touches internal files is dropped rather than published empty.
 *
 * Nothing touches the worktree or the real index: trees are built in a scratch
 * index, commit objects are written straight to the object database, and only
 * `refs/heads/public` moves. Pushing and tagging stay manual, and the internal
 * dev history is never rewritten.
 *
 * The rewrite is incremental and deterministic: the internal→public mapping is
 * cached in `<git-dir>/public-snapshot.public.json`, so a later run replays only
 * the new commits and the already published history keeps its SHAs.
 *
 * Usage:
 *   node scripts/public-snapshot.mjs [--ref <ref>] [--reset] [--dry-run]
 *   node scripts/public-snapshot.mjs --help
 *
 * After it runs:
 *   git push --force github public:main
 *   git push --force github <public sha>:refs/tags/vX.Y.Z   # per release tag
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), '..')
const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}

if (flag('help') || flag('h')) {
  const lines = readFileSync(scriptPath, 'utf8').split('\n')
  const start = lines.findIndex(line => line.trim() === '/**') + 1
  const end = lines.findIndex(line => line.trim() === '*/')
  const body = lines.slice(start, end <= start ? lines.length : end)
  console.log(body.map(line => line.replace(/^ \* ?/, '')).join('\n').trim())
  process.exit(0)
}

const BASE = option('ref', 'HEAD')
const BRANCH = 'public'
const RESET = flag('reset')
const DRY_RUN = flag('dry-run')

const CONFIG = {
  version: 2,
  excludedFiles: ['AGENTS.md', 'scripts/sync-profile.mjs'],
  keptDocs: ['docs/releases.md'],
  droppedScripts: ['sync-profile'],
}
const CONFIG_ID = createHash('sha256').update(JSON.stringify(CONFIG)).digest('hex').slice(0, 16)
const isExcluded = path => CONFIG.excludedFiles.includes(path)
  || (path.startsWith('docs/') && !CONFIG.keptDocs.includes(path))

const git = (args, options = {}) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options })
const gitRaw = (args, input) =>
  execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'buffer', input, maxBuffer: 512 * 1024 * 1024 })
const fail = message => { throw new Error(`public-snapshot: ${message}`) }

const repoPath = relative => resolve(repoRoot, git(['rev-parse', relative]).trim())
const gitCommonDir = repoPath('--git-common-dir')
const statePath = join(gitCommonDir, `public-snapshot.${BRANCH}.json`)
const indexEnv = { ...process.env, GIT_INDEX_FILE: join(gitCommonDir, `public-snapshot.${process.pid}.index`) }
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Cached rewrite state of a previous run, trusted only for commits still reachable from the branch. */
const loadState = () => {
  const fresh = { config: CONFIG_ID, commits: {} }
  if (RESET || !existsSync(statePath)) return fresh
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    return state.config === CONFIG_ID && state.commits ? state : fresh
  } catch {
    return fresh
  }
}

const batchCheck = shas => {
  const out = git(['cat-file', '--batch-check'], { input: `${shas.join('\n')}\n` }).trim()
  const present = new Set()
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, type] = line.split(' ')
    if (type !== 'missing') present.add(sha)
  }
  return present
}

/** Raw commit objects for the commits this run has to replay. */
const readRawCommits = shas => {
  const raw = new Map()
  for (let at = 0; at < shas.length; at += 200) {
    const chunk = shas.slice(at, at + 200)
    const out = gitRaw(['cat-file', '--batch'], Buffer.from(`${chunk.join('\n')}\n`))
    let cursor = 0
    while (cursor < out.length) {
      const eol = out.indexOf(0x0a, cursor)
      if (eol === -1) break
      const [sha, type, size] = out.toString('utf8', cursor, eol).split(' ')
      if (type !== 'commit') fail(`${sha} is a ${type}, not a commit`)
      const start = eol + 1
      raw.set(sha, out.subarray(start, start + Number(size)))
      cursor = start + Number(size) + 1
    }
  }
  return raw
}

/** The public tree of one internal commit: its tree minus the internal paths. */
const filterTree = internalSha => {
  const paths = git(['ls-tree', '-r', '-z', '--name-only', internalSha]).split('\0').filter(Boolean)
  const dropped = paths.filter(isExcluded)
  git(['read-tree', internalSha], { env: indexEnv })
  for (let at = 0; at < dropped.length; at += 200) {
    git(['update-index', '--force-remove', '--', ...dropped.slice(at, at + 200)], { env: indexEnv })
  }
  if (paths.includes('package.json') && !dropped.includes('package.json')) {
    const manifest = JSON.parse(git(['show', `${internalSha}:package.json`]))
    let changed = false
    for (const name of CONFIG.droppedScripts) {
      if (manifest.scripts?.[name] !== undefined) {
        delete manifest.scripts[name]
        changed = true
      }
    }
    if (changed) {
      const mode = git(['ls-tree', internalSha, '--', 'package.json']).split(' ')[0] || '100644'
      const blob = gitRaw(['hash-object', '-w', '--stdin'], Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
        .toString('utf8').trim()
      git(['update-index', '--add', '--cacheinfo', `${mode},${blob},package.json`], { env: indexEnv })
    }
  }
  return git(['write-tree'], { env: indexEnv }).trim()
}

/** Rebuild the commit object with a new tree and parents, keeping every other header and the raw message. */
const writeCommit = (internalSha, tree, parents, raw) => {
  const split = raw.indexOf('\n\n')
  if (split === -1) fail(`${internalSha} has no commit message separator`)
  const groups = []
  for (const line of raw.subarray(0, split).toString('utf8').split('\n')) {
    if (line.startsWith(' ') && groups.length > 0) {
      groups[groups.length - 1].push(line)
      continue
    }
    groups.push([line])
  }
  const rebuilt = [
    `tree ${tree}`,
    ...parents.map(parent => `parent ${parent}`),
    ...groups
      .filter(([first]) => !['tree', 'parent', 'gpgsig', 'gpgsig-sha256', 'mergetag'].includes(first.split(' ')[0]))
      .map(group => group.join('\n')),
  ].join('\n')
  const object = Buffer.concat([
    Buffer.from(`${rebuilt}\n\n`, 'utf8'),
    raw.subarray(split + 2),
  ])
  return gitRaw(['hash-object', '-w', '-t', 'commit', '--stdin'], object).toString('utf8').trim()
}

try {
  const baseSha = git(['rev-parse', '--verify', `${BASE}^{commit}`]).trim()
  const oldTip = (() => {
    try {
      return git(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).trim()
    } catch {
      return undefined
    }
  })()
  const reachable = oldTip === undefined
    ? new Set()
    : new Set(git(['rev-list', oldTip]).split('\n').filter(Boolean))

  const state = loadState()
  const reuse = new Map()
  for (const [internalSha, publicSha] of Object.entries(state.commits)) {
    if (publicSha === null) reuse.set(internalSha, null)
    else if (reachable.has(publicSha)) reuse.set(internalSha, publicSha)
  }

  const parentsOf = new Map()
  const order = []
  for (const line of git(['rev-list', '--parents', '--reverse', '--topo-order', baseSha]).split('\n').filter(Boolean)) {
    const [sha, ...parents] = line.split(' ')
    order.push(sha)
    parentsOf.set(sha, parents)
  }
  if (order.length === 0) fail(`ref ${BASE} has no commits`)

  const todo = order.filter(sha => !reuse.has(sha))
  const rawCommits = readRawCommits(todo)
  const published = new Map()
  const publicTrees = new Map()
  const treeOfPublic = publicSha => {
    const known = publicTrees.get(publicSha)
    if (known !== undefined) return known
    const tree = git(['rev-parse', `${publicSha}^{tree}`]).trim()
    publicTrees.set(publicSha, tree)
    return tree
  }

  /** Nearest published ancestor of an internal commit; skipped commits collapse onto it. */
  const firstPublished = internalSha => {
    const queue = [internalSha]
    const seen = new Set()
    while (queue.length > 0) {
      const at = queue.shift()
      if (seen.has(at)) continue
      seen.add(at)
      const value = published.get(at)
      if (value) return value
      if (value === undefined) continue
      queue.push(...(parentsOf.get(at) ?? []))
    }
    return undefined
  }

  for (const internalSha of order) {
    if (published.has(internalSha)) continue
    if (reuse.has(internalSha)) {
      published.set(internalSha, reuse.get(internalSha))
      continue
    }
    const parents = [...new Set((parentsOf.get(internalSha) ?? [])
      .map(firstPublished)
      .filter(Boolean))]
    const tree = filterTree(internalSha)
    if (parents.length <= 1 && tree === (parents.length === 0 ? EMPTY_TREE : treeOfPublic(parents[0]))) {
      published.set(internalSha, null)
      continue
    }
    published.set(internalSha, writeCommit(internalSha, tree, parents, rawCommits.get(internalSha)))
  }

  const tip = published.get(baseSha)
  if (!tip) fail(`${BASE} is not publishable (it only touches internal files)`)

  const tagTargets = []
  const skippedTags = []
  for (const name of git(['tag', '--merged', baseSha, '--sort=refname']).split('\n').filter(Boolean)) {
    const target = git(['rev-parse', '--verify', `refs/tags/${name}^{commit}`]).trim()
    const publicSha = published.get(target)
    if (publicSha) tagTargets.push([name, publicSha])
    else skippedTags.push(name)
  }

  if (!DRY_RUN) {
    const updateArgs = ['update-ref', `refs/heads/${BRANCH}`, tip]
    if (oldTip !== undefined) updateArgs.push(oldTip)
    git(updateArgs)
    writeFileSync(statePath, `${JSON.stringify({
      config: CONFIG_ID,
      branch: BRANCH,
      head: baseSha,
      commits: Object.fromEntries(published),
    }, null, 2)}\n`)
  }

  const values = [...published.values()]
  const kept = values.filter(Boolean).length
  const skipped = values.filter(value => value === null).length
  console.log(`${DRY_RUN ? 'would mirror' : 'mirrored'} ${BASE} (${baseSha.slice(0, 12)}) onto ${BRANCH}`)
  console.log(`  ${order.length} internal commits -> ${kept} published, ${skipped} dropped (internal-only)`)
  console.log(`  tip ${tip.slice(0, 12)}${oldTip === undefined ? ' (initial)' : oldTip === tip ? ' (unchanged)' : ` (was ${oldTip.slice(0, 12)})`}`)
  if (tagTargets.length > 0) {
    console.log('  tags:')
    for (const [name, sha] of tagTargets) console.log(`    ${name} -> ${sha.slice(0, 12)}`)
  }
  if (skippedTags.length > 0) console.log(`  tags skipped (hit an internal-only commit): ${skippedTags.join(', ')}`)
  console.log('next (manual):')
  console.log(`  git push --force github ${BRANCH}:main`)
  for (const [name, sha] of tagTargets) console.log(`  git push --force github ${sha}:refs/tags/${name}`)
} finally {
  rmSync(indexEnv.GIT_INDEX_FILE, { force: true })
}
