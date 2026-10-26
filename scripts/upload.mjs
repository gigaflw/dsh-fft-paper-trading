#!/usr/bin/env node
/**
 * Publish one release artifact to the distribution channels.
 *
 * The artifact is the self-contained tarball that `pnpm run pack:npm` archives
 * under `releases/`; its version comes from package.json. Every channel is
 * idempotent per version: an already published file is kept and only its
 * release link is (re)wired, so a half-finished release can be re-run.
 * Re-packing the same version is not supported — bump the version instead.
 *
 * Usage:
 *   node scripts/upload.mjs --gitlab [--github] [--npm] [options]
 *
 * Channels:
 *   --gitlab   GitLab Generic Package Registry upload + Release asset link.
 *              Reads GITLAB_URL and GITLAB_TOKEN from the repository `.env`.
 *   --github   GitHub Release asset (creates the release as a draft when it is
 *              missing, uploads, then publishes it). Uses the `gh` CLI and the
 *              `github` git remote.
 *   --npm      `npm publish` to registry.npmjs.org with public access.
 *              Credentials come from the caller's npm environment (for a
 *              private userconfig, export NPM_CONFIG_USERCONFIG first).
 *
 * Options:
 *   --version <X.Y.Z>   Version to publish (default: package.json version)
 *   --tag <vX.Y.Z>      Release tag (default: v<version>; the tag must exist)
 *   --file <path>       Artifact (default: releases/<scope-name>-<version>.tgz)
 *   --notes <path>      Release notes (default: the matching CHANGELOG.md section)
 *   --dry-run           Print the plan without calling any API
 *   -h, --help          Print this help
 *
 * A slow uplink can be sent through a proxy with the usual curl/npm
 * environment variables (`HTTPS_PROXY=...`); the script inherits the caller's
 * environment for every external command.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
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
  console.log(lines.slice(start, end).map(line => line.replace(/^ \* ?/u, '')).join('\n').trim())
  process.exit(0)
}

const fail = message => { throw new Error(message) }
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', ...options })
  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  return result
}
const capture = (command, args) => run(command, args).stdout.trim()

/** KEY=value lines from the repository `.env`, without overriding the environment. */
const loadDotEnv = () => {
  const path = join(repoRoot, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/u.exec(line.trim())
    if (match !== null && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}

/** `owner/repo` of a git remote, or undefined when it is not configured. */
const remoteRepo = name => {
  try {
    const url = capture('git', ['remote', 'get-url', name])
    return /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/u.exec(url)?.[1]
  } catch {
    return undefined
  }
}

/** The artifact name `pnpm pack` gives a scoped package. */
const artifactName = (name, version) => `${name.replace(/^@/u, '').replace(/\//gu, '-')}-${version}.tgz`

/** One version's section of CHANGELOG.md, without the heading and the link block. */
const changelogSection = version => {
  const path = join(repoRoot, 'CHANGELOG.md')
  if (!existsSync(path)) fail('CHANGELOG.md is missing')
  const lines = readFileSync(path, 'utf8').split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start === -1) fail(`CHANGELOG.md has no "## [${version}]" section`)
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
  if (end === -1) end = lines.findIndex((line, index) => index > start && /^\[[0-9]/u.test(line))
  if (end === -1) end = lines.length
  const body = lines.slice(start + 1, end).join('\n').trim()
  if (body === '') fail(`CHANGELOG.md section ${version} is empty`)
  return body
}

/** Absolute path of the release notes, written to dsh_tmp/ when extracted. */
const notesPath = (tag, version, custom) => {
  if (custom !== undefined) return resolve(repoRoot, custom)
  const dir = join(repoRoot, 'dsh_tmp')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `release-notes-${tag}.md`)
  writeFileSync(path, `${changelogSection(version)}\n`)
  return path
}

/** Read one GitLab API path; returns status and parsed body. */
const gitlabApi = async (base, token, path, init = {}) => {
  const response = await fetch(`${base}/api/v4${path}`, {
    ...init,
    headers: { 'PRIVATE-TOKEN': token, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body
  try { body = text === '' ? undefined : JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}
const encodeProject = project => encodeURIComponent(project)

const uploadGitlab = async ({ file, version, tag, notes, dryRun }) => {
  const base = (process.env.GITLAB_URL ?? '').replace(/\/+$/u, '')
  const token = process.env.GITLAB_TOKEN
  const project = process.env.GITLAB_PROJECT ?? remoteRepo('gitlab')
  const missing = [
    base === '' ? 'GITLAB_URL' : undefined,
    token === undefined || token === '' ? 'GITLAB_TOKEN' : undefined,
    project === undefined ? 'GITLAB_PROJECT（或仓库的 gitlab remote）' : undefined,
  ].filter(Boolean)
  if (missing.length > 0) fail(`missing ${missing.join(', ')}; put them in the repository .env`)

  const key = encodeProject(project)
  const name = basename(file)
  const suffix = `-${version}.tgz`
  if (!name.endsWith(suffix)) fail(`${name} does not carry version ${version}`)
  const packageName = name.slice(0, -suffix.length)
  const uploadPath = `/projects/${key}/packages/generic/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/${encodeURIComponent(name)}`
  if (dryRun) {
    console.log(`[gitlab] would upload ${file} -> ${packageName}@${version}`)
    console.log(`[gitlab] would ensure release ${tag} and its asset link`)
    return
  }

  const release = await gitlabApi(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}`)
  if (release.status === 404) {
    const created = await gitlabApi(base, token, `/projects/${key}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tag, tag_name: tag, description: notes }),
    })
    if (created.status >= 300) fail(`gitlab release creation failed: ${created.status} ${JSON.stringify(created.body)}`)
    console.log(`[gitlab] release ${tag} created`)
  } else if (release.status >= 300) {
    fail(`gitlab release lookup failed: ${release.status}`)
  }

  const lookupPackages = async () => gitlabApi(base, token, `/projects/${key}/packages?package_type=generic&per_page=100`)
  const existing = async () => {
    const packages = await lookupPackages()
    if (packages.status >= 300) fail(`gitlab package lookup failed: ${packages.status}`)
    const found = (Array.isArray(packages.body) ? packages.body : []).find(entry => entry.name === packageName && entry.version === version)
    if (found === undefined) return undefined
    const files = await gitlabApi(base, token, `/projects/${key}/packages/${found.id}/package_files?per_page=100`)
    if (files.status >= 300) fail(`gitlab package file lookup failed: ${files.status}`)
    const fileEntry = (Array.isArray(files.body) ? files.body : []).find(entry => entry.file_name === name)
    return fileEntry === undefined ? undefined : { package: found, file: fileEntry }
  }

  let published = await existing()
  if (published === undefined) {
    const upload = await gitlabApi(base, token, uploadPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(file),
    })
    if (upload.status >= 300) fail(`gitlab upload failed: ${upload.status} ${JSON.stringify(upload.body)}`)
    published = await existing()
    if (published === undefined) fail('gitlab upload finished but the package is not listed')
    console.log(`[gitlab] uploaded ${name} -> ${packageName}@${version} (package ${published.package.id})`)
  } else {
    console.log(`[gitlab] ${packageName}@${version} already published, keeping it`)
  }

  const assetUrl = `${base}/${project}/-/package_files/${published.file.id}/download`
  const current = await gitlabApi(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}`)
  const links = current.body?.assets?.links ?? []
  const sameName = links.find(link => link.name === name)
  const linkBody = JSON.stringify({ name, url: assetUrl, link_type: 'package' })
  const written = sameName === undefined
    ? await gitlabApi(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}/assets/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: linkBody,
      })
    : await gitlabApi(base, token, `/projects/${key}/releases/${encodeURIComponent(tag)}/assets/links/${sameName.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: linkBody,
      })
  if (written.status >= 300) fail(`gitlab release asset link failed: ${written.status} ${JSON.stringify(written.body)}`)
  console.log(`[gitlab] release ${tag} asset link ${sameName === undefined ? 'added' : 'updated'}: ${assetUrl}`)
}

const uploadGithub = ({ file, version, tag, notes, dryRun }) => {
  const repo = remoteRepo('github')
  if (repo === undefined) fail('the `github` git remote is not configured')
  const state = (() => {
    const result = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,url'], { cwd: repoRoot, encoding: 'utf8' })
    if (result.status !== 0) return undefined
    return JSON.parse(result.stdout)
  })()

  if (dryRun) {
    console.log(`[github] would ${state === undefined ? 'create a draft release and ' : ''}upload ${file} to ${repo} ${tag}${state?.isDraft === true ? ', then publish it' : ''}`)
    return
  }

  const tagRefs = run('git', ['ls-remote', '--tags', 'github', `refs/tags/${tag}`]).stdout.trim()
  if (tagRefs === '') fail(`tag ${tag} is not on the github remote; push the mirrored commit as the tag first`)
  if (state === undefined) {
    run('gh', ['release', 'create', tag, '--repo', repo, '--title', tag, '--verify-tag', '--draft', '--notes-file', notes])
  }
  run('gh', ['release', 'upload', tag, file, '--repo', repo, '--clobber'])
  if (state === undefined || state.isDraft === true) {
    run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false'])
  }
  const url = capture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'url', '--jq', '.url'])
  console.log(`[github] release ${tag}: ${url}`)
}

const uploadNpm = ({ file, name, version, dryRun }) => {
  const registry = 'https://registry.npmjs.org/'
  const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--registry', registry], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const published = view.status === 0 && view.stdout.trim() !== ''
  if (dryRun) {
    console.log(`[npm] would ${published ? 'skip (already published)' : 'publish'} ${name}@${version} to ${registry}`)
    return
  }
  if (published) fail(`${name}@${version} is already on npm; bump the version instead of re-packing`)
  run('npm', ['publish', file, '--registry', registry, '--access', 'public'], { stdio: 'inherit' })
  console.log(`[npm] ${name}@${version}: https://www.npmjs.com/package/${name}/v/${version}`)
}

const main = async () => {
  loadDotEnv()
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const version = option('version', manifest.version)
  const tag = option('tag', `v${version}`)
  const file = resolve(repoRoot, option('file', join('releases', artifactName(manifest.name, version))))
  if (!existsSync(file)) fail(`artifact not found: ${file}（先运行 pnpm run pack:npm）`)
  const notes = notesPath(tag, version, option('notes', undefined))
  const dryRun = flag('dry-run')

  const channels = [flag('gitlab') ? 'gitlab' : undefined, flag('github') ? 'github' : undefined, flag('npm') ? 'npm' : undefined].filter(Boolean)
  if (channels.length === 0) fail('pick at least one channel: --gitlab, --github or --npm')

  console.log(`[upload] ${manifest.name}@${version}, artifact ${file}`)
  for (const channel of channels) {
    if (channel === 'gitlab') await uploadGitlab({ file, version, tag, notes: readFileSync(notes, 'utf8'), dryRun })
    if (channel === 'github') uploadGithub({ file, version, tag, notes, dryRun })
    if (channel === 'npm') uploadNpm({ file, name: manifest.name, version, dryRun })
  }
}

main().catch((error) => {
  console.error(`upload: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
