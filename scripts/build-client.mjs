import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(resolve(root, 'lib'), { recursive: true })
await copyFile(resolve(root, 'src/client/index.js'), resolve(root, 'lib/client.js'))
