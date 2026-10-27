import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkPair,
  corpusSources,
  pairPaths,
  pairViolations,
  sourceOfArgument,
  structureViolations,
} from '../scripts/verify-translation-pairing.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = resolve(repoRoot, 'scripts/verify-translation-pairing.mjs')

const EN = '# Title\n\nEnglish | [中文](README.zh.md)\n\nIntro.\n\n## Usage\n\n- one\n- two\n'
const ZH = '# 标题\n\n[English](README.md) | 中文\n\n简介。\n\n## 用法\n\n- 一\n- 二\n'

test('pairPaths derives the Chinese counterpart from the English path', () => {
  assert.deepEqual(pairPaths('README.md'), { source: 'README.md', zh: 'README.zh.md' })
  assert.throws(() => pairPaths('README.zh.md'), /expected an English Markdown path/)
})

test('the corpus and pair arguments resolve to the root README', () => {
  assert.ok(corpusSources(repoRoot).includes('README.md'))
  for (const argument of ['README.md', 'README.zh.md', 'README']) {
    assert.equal(sourceOfArgument(argument, repoRoot).source, 'README.md')
  }
  assert.throws(() => sourceOfArgument('missing.md', repoRoot), /no README pair/)
})

test('matching pairs produce no violations, switcher style included', () => {
  assert.deepEqual(pairViolations(EN, ZH), [])
  const absolute = EN.replace('English | [中文](README.zh.md)', 'English | [中文](https://github.com/gigaflw/dsh-fft-paper-trading/blob/main/README.zh.md)')
  assert.deepEqual(pairViolations(absolute, ZH), [])
  assert.deepEqual(structureViolations(EN, ZH), [])
  // Prose reworded on one side is a review concern, not a gate failure.
  assert.deepEqual(pairViolations(EN.replace('Intro.', 'Intro changed.'), ZH), [])
})

test('the gate names every structural mismatch', () => {
  const mismatch = (en, zh) => pairViolations(en, zh).join('\n')
  assert.match(mismatch(EN, ZH.replace('## 用法', '### 用法')), /heading depths/)
  assert.match(mismatch(`${EN}\n\`\`\`sh\none\n\`\`\`\n`, `${ZH}\n\`\`\`sh\ntwo\n\`\`\`\n`), /fenced code block #1 differs/)
  assert.match(mismatch(EN, ZH.replace('- 二\n', '')), /list shapes/)
  assert.match(mismatch('# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', '# 甲\n\n| 甲 | 乙 |\n| --- | --- |\n'), /table shapes/)
  assert.match(mismatch(`${EN}\n[Foo](CHANGELOG.md)\n`, `${ZH}\n[Foo](CHANGELOG.zh.md)\n`), /link #1/)
})

test('the gate rejects a missing or misplaced language switcher', () => {
  assert.match(pairViolations(EN.replace('English | [中文](README.zh.md)\n\n', ''), ZH).join('\n'), /line after the H1/)
  assert.match(pairViolations(EN, ZH.replace('[English](README.md) | 中文', '[English](README.md)')).join('\n'), /line after the H1/)
  assert.match(pairViolations(EN.replace('README.zh.md', 'README.en.md'), ZH).join('\n'), /must target README\.zh\.md/)
})

test('the repository README pair is complete and aligned', () => {
  assert.deepEqual(checkPair('README.md', repoRoot), [])
})

test('the CLI exits 0 for the repository pair', () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [scriptPath], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(status, 0, stderr)
  assert.match(stdout, /README\.md: ok/)
})
