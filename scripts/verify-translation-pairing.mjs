#!/usr/bin/env node
/**
 * Bilingual-pair gate for the repository's root README.
 *
 * The README ships as a pair: English `README.md` and Chinese `README.zh.md`,
 * each carrying a language switcher under its H1. Both languages carry equal
 * authority, so the pair must stay structurally identical — same headings,
 * byte-identical fenced code blocks, same table and list shapes, and links that
 * point at the same targets with the locale of paired documents resolved.
 *
 * This is the cheap half of the upstream DeepSeek Harness pairing contract: it
 * catches the drift that actually happens (a feature bullet added on one side,
 * a code sample edited on one side) with no maintenance ritual. The per-section
 * hash record upstream relies on pays off only for a large corpus with
 * concurrent translation branches; prose reworded on one side stays a review
 * concern here.
 *
 * Usage:
 *   node scripts/verify-translation-pairing.mjs [pair...]
 *
 * A pair is named by either of its two files, or by its bare stem (`README`).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), '..')

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^`]*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_MARKER = /^(\s{0,3})([-*+]|\d{1,9}[.)])\s+/
const INLINE_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const REFERENCE_DEFINITION = /^\s*\[[^\]]+\]:\s*(\S+)/
const SWITCHER_EN = /^English \| \[中文\]\(([^)]+)\)$/
const SWITCHER_ZH = /^\[English\]\(([^)]+)\) \| 中文$/
const REPOSITORY_BLOB_ROOT = 'https://github.com/gigaflw/dsh-fft-paper-trading/blob/main/'

/** The two repository-relative paths that form one pair. */
export function pairPaths(source) {
  if (!source.endsWith('.md') || source.endsWith('.zh.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return { source, zh: source.replace(/\.md$/, '.zh.md') }
}

/** Every root README (case-insensitive) is in the corpus, discovered per run. */
export function corpusSources(root = repoRoot) {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^readme\.md$/i.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

/** Resolve a CLI argument (`README.md`, `README.zh.md`, `README`) to its pair. */
export function sourceOfArgument(argument, root = repoRoot) {
  const name = argument.replace(/^\.\//, '')
  const candidate = name.endsWith('.zh.md') ? name.slice(0, -'.zh.md'.length) + '.md' : name.endsWith('.md') ? name : `${name}.md`
  if (existsSync(join(root, candidate))) return pairPaths(candidate)
  throw new Error(`${argument}: no README pair in this repository`)
}

/** Split one side into its heading sections, keeping fenced code blocks out of the running text. */
function sectionsOf(markdown) {
  const lines = markdown.split('\n')
  const sections = [{ heading: undefined, lines: [] }]
  const fences = []
  let fence
  for (const [index, text] of lines.entries()) {
    if (fence !== undefined) {
      const marker = fence.marker[0] === '`' ? '`' : '~'
      if (new RegExp(`^\\s*${marker}{${fence.marker.length},}\\s*$`).test(text)) {
        fences.push({ info: fence.info, body: fence.body.join('\n'), line: fence.line, endLine: index })
        fence = undefined
      } else {
        fence.body.push(text)
      }
      continue
    }
    const opened = FENCE_OPEN.exec(text)
    if (opened !== null) {
      fence = { marker: opened[1], info: opened[2].trim(), body: [], line: index }
      continue
    }
    const heading = HEADING.exec(text)
    if (heading !== null) {
      sections.push({ heading: { depth: heading[1].length }, lines: [] })
      continue
    }
    sections.at(-1).lines.push({ text, line: index })
  }
  if (fence !== undefined) throw new Error('unclosed fenced code block')
  return { lines, sections, fences }
}

/** The line after the H1 that carries the language switcher. */
function switcherOf(markdown) {
  const lines = markdown.split('\n')
  const heading = lines.findIndex(text => HEADING.test(text))
  if (heading === -1) return undefined
  for (let index = heading + 1; index < lines.length; index++) {
    if (lines[index].trim() === '') continue
    return { line: index, text: lines[index].trim() }
  }
  return undefined
}

/** A switcher may name its counterpart relatively or through the public repository. */
function switcherTargets(counterpart) {
  return [counterpart, `${REPOSITORY_BLOB_ROOT}${counterpart}`]
}

/** Ordered structural signature: everything the two languages must share. */
function signatureOf(markdown) {
  const { lines, sections, fences } = sectionsOf(markdown)
  const switcher = switcherOf(markdown)
  const headings = sections.map(section => section.heading?.depth).filter(depth => depth !== undefined)
  const tables = []
  const lists = []
  for (const section of sections) {
    const content = section.lines
    for (let index = 0; index < content.length; index++) {
      const text = content[index].text
      const next = content[index + 1]?.text
      if (text.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next)) {
        let cursor = index + 2
        while (cursor < content.length && content[cursor].text.includes('|')) cursor += 1
        const trimmed = text.trim()
        const columns = trimmed.split('|').length - (trimmed.startsWith('|') ? 1 : 0) - (trimmed.endsWith('|') ? 1 : 0)
        tables.push(`${cursor - index}x${columns}`)
        index = cursor - 1
        continue
      }
      const marker = LIST_MARKER.exec(text)
      if (marker === null) continue
      const indent = marker[1].length
      const kind = /\d/.test(marker[2]) ? 'ol' : 'ul'
      const start = kind === 'ol' ? parseInt(marker[2], 10) : 1
      let items = 0
      let cursor = index
      while (cursor < content.length) {
        const current = content[cursor].text
        const currentMarker = LIST_MARKER.exec(current)
        if (currentMarker !== null && currentMarker[1].length === indent) {
          items += 1
          cursor += 1
          continue
        }
        if (current.trim() === '') {
          const following = content[cursor + 1]?.text
          const followingMarker = following === undefined ? null : LIST_MARKER.exec(following)
          if (following !== undefined && (followingMarker !== null ? followingMarker[1].length === indent : /^\s+/.test(following))) {
            cursor += 1
            continue
          }
          break
        }
        if (/^\s+/.test(current)) {
          cursor += 1
          continue
        }
        break
      }
      lists.push(`${kind}:${start}:${items}`)
      index = cursor - 1
    }
  }
  const links = []
  for (const [index, text] of lines.entries()) {
    if (fences.some(fence => index >= fence.line && index <= fence.endLine)) continue
    if (switcher !== undefined && index === switcher.line) continue
    for (const match of text.matchAll(INLINE_LINK)) links.push(match[1])
    const reference = REFERENCE_DEFINITION.exec(text)
    if (reference !== null) links.push(reference[1])
    for (const match of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) links.push(match[1])
  }
  return { switcher, headings, code: fences.map(fence => ({ info: fence.info, body: fence.body })), tables, lists, links }
}

/** Relative paired documents use `.md` on the English side and `.zh.md` on the Chinese side. */
function linkExpectation(target, side, root) {
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#') && !target.startsWith('/')
  if (!relative) return { kind: 'plain', value: target }
  if (side === 'en' && target.endsWith('.md') && existsSync(join(root, target.replace(/\.md$/, '.zh.md')))) {
    return { kind: 'paired', value: target }
  }
  if (side === 'zh' && target.endsWith('.zh.md') && existsSync(join(root, target))) {
    return { kind: 'paired', value: target.replace(/\.zh\.md$/, '.md') }
  }
  return { kind: 'plain', value: target }
}

/**
 * Structural mismatches between one pair's contents.
 *
 * @returns {string[]} Mismatches, empty when the two sides share a shape.
 */
export function structureViolations(en, zh, root = repoRoot) {
  const left = signatureOf(en)
  const right = signatureOf(zh)
  const mismatches = []
  const enHeadings = left.headings.join(',')
  const zhHeadings = right.headings.join(',')
  if (enHeadings !== zhHeadings) mismatches.push(`heading depths: English [${enHeadings}] vs Chinese [${zhHeadings}]`)
  if (JSON.stringify(left.code) !== JSON.stringify(right.code)) {
    const index = left.code.findIndex((fence, at) => JSON.stringify(fence) !== JSON.stringify(right.code[at]))
    mismatches.push(`fenced code block #${index + 1} differs (info strings and bodies must be byte-identical)`)
  }
  const enTables = left.tables.join(',')
  const zhTables = right.tables.join(',')
  if (enTables !== zhTables) mismatches.push(`table shapes: English [${enTables}] vs Chinese [${zhTables}]`)
  const enLists = left.lists.join(',')
  const zhLists = right.lists.join(',')
  if (enLists !== zhLists) mismatches.push(`list shapes: English [${enLists}] vs Chinese [${zhLists}]`)
  const enLinks = left.links.map(target => linkExpectation(target, 'en', root))
  const zhLinks = right.links.map(target => linkExpectation(target, 'zh', root))
  if (JSON.stringify(enLinks) !== JSON.stringify(zhLinks)) {
    const index = enLinks.findIndex((link, at) => JSON.stringify(link) !== JSON.stringify(zhLinks[at]))
    const describe = link => link === undefined ? 'missing' : `${link.kind} ${link.value}`
    mismatches.push(`link #${index + 1}: English ${describe(enLinks[index])} vs Chinese ${describe(zhLinks[index])}`)
  }
  return mismatches
}

/**
 * Violations for one pair's already-read contents.
 *
 * @returns {string[]} Violations, empty when the two sides are aligned.
 */
export function pairViolations(en, zh, paths = pairPaths('README.md'), root = repoRoot) {
  const violations = []
  const enSwitch = switcherOf(en)
  const zhSwitch = switcherOf(zh)
  if (enSwitch === undefined || SWITCHER_EN.test(enSwitch.text) === false) {
    violations.push(`${paths.source}: the line after the H1 must be "English | [中文](<README.zh.md>)"`)
  } else if (!switcherTargets(paths.zh).includes(SWITCHER_EN.exec(enSwitch.text)[1])) {
    violations.push(`${paths.source}: the language switcher must target ${paths.zh} (relative, or ${REPOSITORY_BLOB_ROOT}${paths.zh})`)
  }
  if (zhSwitch === undefined || SWITCHER_ZH.test(zhSwitch.text) === false) {
    violations.push(`${paths.zh}: the line after the H1 must be "[English](<README.md>) | 中文"`)
  } else if (!switcherTargets(paths.source).includes(SWITCHER_ZH.exec(zhSwitch.text)[1])) {
    violations.push(`${paths.zh}: the language switcher must target ${paths.source}`)
  }
  for (const mismatch of structureViolations(en, zh, root)) violations.push(`${paths.source}/${paths.zh}: ${mismatch}`)
  return violations
}

/**
 * Check one pair.
 *
 * @returns {string[]} Violations, empty when the pair is complete and aligned.
 */
export function checkPair(source, root = repoRoot) {
  const paths = pairPaths(source)
  const read = relative => {
    const absolute = join(root, relative)
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined
  }
  const en = read(paths.source)
  const zh = read(paths.zh)
  if (en === undefined) return [`${paths.source} is missing`]
  if (zh === undefined) return [`${paths.zh} is missing (every root README needs its Chinese counterpart)`]
  return pairViolations(en, zh, paths, root)
}

function printHelp() {
  console.log(readFileSync(scriptPath, 'utf8').split('*/')[0].split('/**')[1].replace(/^ \* ?/gm, '').trim())
}

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp()
    return 0
  }
  const unknown = argv.find(argument => argument.startsWith('--'))
  if (unknown !== undefined) {
    console.error(`verify:translation: unknown option ${unknown}`)
    return 1
  }
  let sources
  try {
    sources = argv.length > 0 ? argv.map(argument => sourceOfArgument(argument).source) : corpusSources()
  } catch (error) {
    console.error(`verify:translation: ${error.message}`)
    return 1
  }
  if (sources.length === 0) {
    console.log('verify:translation: no README pairs in this repository')
    return 0
  }
  let failed = false
  for (const source of sources) {
    const violations = checkPair(source)
    for (const violation of violations) console.error(`verify:translation: ${violation}`)
    if (violations.length > 0) failed = true
    else console.log(`${source}: ok`)
  }
  return failed ? 1 : 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  process.exitCode = main(process.argv.slice(2))
}
