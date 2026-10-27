/**
 * The prune table is what keeps the published tarball runtime-only.
 *
 * `pack-npm` applies it to the staging copy of the inlined kline archive, so the
 * matching rules decide what users download: a rule that is too wide drops a
 * file the plugin reads, a rule that is too narrow silently ships megabytes of
 * screenshots. These tests pin the segment semantics and the reported numbers;
 * the archived tarball itself is asserted by `pack-npm`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRUNE, pruneMatcher, pruneStaged } from '../scripts/pack-prune.mjs'

const ROOT = join(import.meta.dirname, '..')
const SCRATCH_ROOT = join(ROOT, 'build')
mkdirSync(SCRATCH_ROOT, { recursive: true })
const scratch = []

/** A staging fixture shaped like the inlined kline archive. */
function fixture() {
  const dir = mkdtempSync(join(SCRATCH_ROOT, 'pack-prune-'))
  scratch.push(dir)
  const write = (path, bytes = path.length) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), 'x'.repeat(bytes))
  }
  write('package.json', 10)
  write('lib/index.js', 100)
  write('lib/client.js', 200)
  write('lib/client/generated-view.js', 300)
  write('lib/client.js.map', 400)
  write('docs/images/storefront.png', 500)
  write('docs/release-acceptance.md', 50)
  write('screenshots.json', 20)
  write('view/kline.html', 600)
  write('view/vendor/klinecharts.min.js', 700)
  write('view/ft-logo.jpg', 80)
  return dir
}

test.after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

test('a rule matches one path segment and its subtree', () => {
  assert.ok(pruneMatcher('docs').test('docs'))
  assert.ok(pruneMatcher('docs').test('docs/images/storefront.png'))
  assert.ok(!pruneMatcher('docs').test('docs.md'))
  assert.ok(!pruneMatcher('docs').test('build/docs/x.png'))
})

test('a rule never eats a longer sibling name', () => {
  assert.ok(pruneMatcher('lib/client').test('lib/client/generated-view.js'))
  assert.ok(!pruneMatcher('lib/client').test('lib/client.js'), 'the ./client entry must survive')
  assert.ok(pruneMatcher('lib/client.js.map').test('lib/client.js.map'))
  assert.ok(!pruneMatcher('lib/client.js.map').test('lib/client.js.map.x'))
})

test('glob wildcards stay inside a segment unless doubled', () => {
  assert.ok(pruneMatcher('lib/*.map').test('lib/index.js.map'))
  assert.ok(!pruneMatcher('lib/*.map').test('lib/agent/format.js.map'))
  assert.ok(pruneMatcher('lib/**/*.map').test('lib/agent/format.js.map'))
  assert.ok(!pruneMatcher('lib/**/*.map').test('lib/index.js.map'))
})

test('pruning drops the table paths and keeps runtime files', () => {
  const dir = fixture()
  const result = pruneStaged('@ftshare-lab/dsh-kline', dir)

  assert.deepEqual(result.unmatched, [])
  assert.deepEqual([...result.removed].sort(), [
    'docs',
    'lib/client',
    'lib/client.js.map',
    'screenshots.json',
    'view/kline.html',
  ])
  // docs/ is dropped as a subtree, so the reported bytes cover every file in it.
  assert.equal(result.bytes, 500 + 50 + 20 + 300 + 400 + 600)

  for (const kept of ['package.json', 'lib/index.js', 'lib/client.js', 'view/vendor/klinecharts.min.js', 'view/ft-logo.jpg']) {
    assert.ok(readFileSync(join(dir, kept)).length > 0, `${kept} must survive pruning`)
  }
})

test('pruning twice is a no-op', () => {
  const dir = fixture()
  pruneStaged('@ftshare-lab/dsh-kline', dir)
  const again = pruneStaged('@ftshare-lab/dsh-kline', dir)
  assert.deepEqual(again.removed, [])
  assert.equal(again.bytes, 0)
})

test('rules that match nothing are reported, not fatal', () => {
  const dir = fixture()
  const result = pruneStaged('@ftshare-lab/dsh-kline', dir, { rules: ['docs', 'no-such-dir'] })
  assert.deepEqual(result.unmatched, ['no-such-dir'])
  assert.equal(result.removed.length, 1)
})

test('the shipped table covers the four kline payloads that are not runtime', () => {
  const rules = PRUNE['@ftshare-lab/dsh-kline']
  for (const path of ['docs/images/storefront.png', 'lib/client/generated-view.js', 'lib/client.js.map', 'view/kline.html', 'screenshots.json']) {
    assert.ok(rules.some(rule => pruneMatcher(rule).test(path)), `${path} must be pruned`)
  }
  for (const path of ['lib/index.js', 'lib/client.js', 'view/vendor/klinecharts.min.js', 'view/ft-logo.jpg']) {
    assert.ok(!rules.some(rule => pruneMatcher(rule).test(path)), `${path} must ship`)
  }
})
