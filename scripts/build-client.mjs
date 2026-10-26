import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const sourcePath = resolve(root, 'src/client/index.js')
const source = await readFile(sourcePath, 'utf8')
// The Feedback link is the only place the browser half needs the release
// number; `lib/` must not gain a runtime RPC just to build a URL, and a report
// without a version is the first thing triage has to ask for.
if (!source.includes('__PAPER_VERSION__')) {
  throw new Error('build-client: version placeholder missing in src/client/index.js')
}
await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/client.js'), source.replaceAll('__PAPER_VERSION__', pkg.version))
