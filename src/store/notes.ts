/**
 * Free-form notes for one account.
 *
 * A single text block the human rewrites however they like: no entries, no
 * timestamps, no history. It lives beside the ledger (`note.md`) instead of the
 * registry so a long note never bloats `accounts.json`, and the model has no
 * tool for it — this is the human's own space.
 * @module @dsh-ft/dsh-fft-paper-trading/store/notes
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NoteView } from '../contract.js'
import { PaperError } from '../service/errors.js'
import { notePath } from './paths.js'

/** 100 KB of UTF-8: a very long research note, still cheap to load and save. */
export const NOTE_MAX_BYTES = 100_000

export interface AccountNotesOptions {
  home: string
  maxBytes?: number
}

export class AccountNotes {
  private readonly home: string
  private readonly maxBytes: number
  /** Writes to one account must land in order; two quick saves used to race
   * for the same temp file and one of them failed with ENOENT. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(options: AccountNotesOptions) {
    this.home = options.home
    this.maxBytes = options.maxBytes ?? NOTE_MAX_BYTES
  }

  /** Read one account's note; a missing file is an empty note, not an error. */
  async read(accountId: string): Promise<NoteView> {
    const file = notePath(this.home, accountId)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { text: '', bytes: 0, maxBytes: this.maxBytes }
      }
      throw new PaperError('INTERNAL', `读取笔记失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    let updatedAt: string | undefined
    try {
      updatedAt = (await stat(file)).mtime.toISOString()
    } catch {
      updatedAt = undefined
    }
    return {
      text,
      bytes: byteLength(text),
      maxBytes: this.maxBytes,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    }
  }

  /** Replace the whole note atomically; an empty string clears it. */
  async write(accountId: string, text: unknown): Promise<NoteView> {
    if (typeof text !== 'string') throw new PaperError('INVALID_ARGUMENT', '笔记内容必须是文本', 400)
    const bytes = byteLength(text)
    if (bytes > this.maxBytes) {
      throw new PaperError('INVALID_ARGUMENT', `笔记不能超过 ${Math.round(this.maxBytes / 1000)} KB（当前 ${Math.round(bytes / 1000)} KB）`, 413)
    }
    const previous = this.queues.get(accountId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const file = notePath(this.home, accountId)
      try {
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.${randomUUID()}.tmp`
        await writeFile(temp, text, 'utf8')
        await rename(temp, file)
      } catch (error) {
        throw new PaperError('INTERNAL', `保存笔记失败：${error instanceof Error ? error.message : String(error)}`, 500)
      }
    })
    this.queues.set(accountId, next.catch(() => undefined))
    await next
    return this.read(accountId)
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
