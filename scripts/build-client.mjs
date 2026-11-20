import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
// The browser half stays one file at runtime (the host loads a single module
// factory), but the source is split by concern under `src/client/parts/` and
// concatenated here in fixed order. Function declarations hoist inside the
// factory, so the parts only need to keep top-level constants before their use.
const PARTS = [
  '10-core.js',
  '20-styles.js',
  '30-atoms.js',
  '40-stock-tabs.js',
  '50-futures.js',
  '60-shell.js',
  '70-plugin.js',
]
const entry = await readFile(resolve(root, 'src/client/entry.js'), 'utf8')
const body = (await Promise.all(PARTS.map(async name => {
  const text = await readFile(resolve(root, 'src/client/parts', name), 'utf8')
  return `    /* ---- ${name} ---- */\n${text.replace(/\n$/, '')}\n`
}))).join('\n')
const source = entry.replace('    // __CLIENT_PARTS__', () => body)
// The Feedback link is the only place the browser half needs the release
// number; `lib/` must not gain a runtime RPC just to build a URL, and a report
// without a version is the first thing triage has to ask for.
if (!source.includes('__PAPER_VERSION__')) {
  throw new Error('build-client: version placeholder missing in the client parts')
}
await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/client.js'), source.replaceAll('__PAPER_VERSION__', pkg.version))
