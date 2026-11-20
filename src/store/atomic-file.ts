/**
 * Atomic whole-file write shared by the small JSON files beside the ledgers.
 *
 * The event log has its own append/fsync path; the registry, the notes file,
 * the shortlist and the futures contract cache are written whole. They all need
 * the same guarantee — a crash leaves either the old or the new file, never a
 * half-written one — and the same unique temp name, so two writers can never
 * clobber each other's staging file.
 * @module @dsh-ft/dsh-fft-paper-trading/store/atomic-file
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicWriteOptions {
  mode?: number
}

/** Write `content` to `file` via a fsynced sibling temp file and a rename. */
export async function writeFileAtomic(file: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    const handle = await open(temp, 'w', options.mode ?? 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}
