/**
 * The Feedback link is a contract with the public repository: a renamed issue
 * form or a dropped template turns the panel's only support entry into a 404,
 * and the build-time version stamp is the one thing triage asks for first.
 *
 * These checks read the built bundle (`lib/client.js`) because that is what the
 * host ships; the source placeholder is asserted separately by the build.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const README_EN = readFileSync(join(ROOT, 'README.md'), 'utf8')
const README_ZH = readFileSync(join(ROOT, 'README.zh.md'), 'utf8')
const READMES = [README_EN, README_ZH]
const TEMPLATE_DIR = join(ROOT, '.github', 'ISSUE_TEMPLATE')

test('feedback: the bundle links the bug form and stamps the release into the title', () => {
  // The build replaces the placeholder; a stale one ships raw to users.
  assert.ok(!client.includes('__PAPER_VERSION__'), 'the build must replace the version placeholder')
  assert.ok(client.includes(`const PAPER_VERSION = '${pkg.version}'`), 'the bundle must carry the package version')
  assert.ok(client.includes('template=bug_report.yml'), 'the panel must open the bug form')
  assert.ok(client.includes('[Bug] v${PAPER_VERSION} '), 'the release must ride in the issue title')
  // GitHub ignores a body param on a form URL and a blank issue 400s when blank
  // issues are disabled, so the body stays user-written.
  assert.ok(!/issues\/new\?[^'"`\s]*body=/.test(client), 'the feedback URL must not prefill the body')
  // External links open in the system browser, never in the panel itself.
  assert.match(client, /function FeedbackLink\(\)/)
  assert.match(client, /target: '_blank'/)
  assert.match(client, /rel: 'noreferrer'/)
  assert.match(client, /className: 'pt-btn pt-feedback'/)
})

test('feedback: every linked form exists and stays a valid issue form', () => {
  const linked = new Set([
    ...[...client.matchAll(/template=([a-z_]+\.yml)/g)].map(match => match[1]),
    ...READMES.flatMap(readme => [...readme.matchAll(/template=([a-z_]+\.yml)/g)].map(match => match[1])),
  ])
  assert.ok(linked.size >= 2, 'both the bug and the feature form must be linked somewhere')
  for (const name of linked) {
    const path = join(TEMPLATE_DIR, name)
    assert.ok(existsSync(path), `missing issue form ${name}`)
    const yaml = readFileSync(path, 'utf8')
    // A form without `body:` fails to parse on GitHub and silently disappears
    // from the chooser.
    for (const field of ['name:', 'description:', 'title:', 'body:']) {
      assert.ok(yaml.includes(field), `${name} lacks ${field}`)
    }
  }
  const config = readFileSync(join(TEMPLATE_DIR, 'config.yml'), 'utf8')
  assert.match(config, /blank_issues_enabled: false/, 'blank issues must be off')
})

test('feedback: both READMEs point at the issue tracker', () => {
  for (const readme of READMES) {
    assert.match(readme, /## (反馈|Feedback)/)
    assert.ok(readme.includes('https://github.com/gigaflw/dsh-fft-paper-trading/issues/new?template=bug_report.yml'))
    assert.ok(readme.includes('https://github.com/gigaflw/dsh-fft-paper-trading/issues/new?template=feature_request.yml'))
  }
})
