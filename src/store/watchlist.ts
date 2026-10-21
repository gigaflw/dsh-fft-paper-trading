import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { paperRoot } from './paths.js'

/** UI preference, deliberately not part of the account ledger. */
export class WatchlistStore {
  private readonly file: string

  constructor(home: string) {
    this.file = join(paperRoot(home), 'watchlist.json')
  }

  async read(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      return Array.isArray(parsed?.symbols)
        ? parsed.symbols.filter((item: unknown): item is string => typeof item === 'string').slice(0, 200)
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      return []
    }
  }

  async write(symbols: string[]): Promise<string[]> {
    const clean = [...new Set(symbols.map(symbol => symbol.trim()).filter(Boolean))].slice(0, 200)
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify({ symbols: clean }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.file)
    return clean
  }
}
