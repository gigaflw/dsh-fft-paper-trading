import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { paperRoot } from './paths.js';
/** UI preference, deliberately not part of the account ledger. */
export class ShortlistStore {
    file;
    /** Pre-rename name of the same file; read once, then moved so the two cannot drift. */
    previous;
    constructor(home) {
        this.file = join(paperRoot(home), 'shortlist.json');
        this.previous = join(paperRoot(home), 'watchlist.json');
    }
    async read() {
        const current = await readSymbols(this.file);
        if (current !== null)
            return current;
        const previous = await readSymbols(this.previous);
        if (previous === null)
            return [];
        // Migration is best effort: a failed rename only means we read the old file
        // again next time, which is the same list.
        await rename(this.previous, this.file).catch(() => { });
        return previous;
    }
    async write(symbols) {
        const clean = [...new Set(symbols.map(symbol => symbol.trim()).filter(Boolean))].slice(0, 200);
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ symbols: clean }, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.file);
        return clean;
    }
}
/** `null` when the file does not exist; `[]` when it exists but is unusable. */
async function readSymbols(file) {
    try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return Array.isArray(parsed?.symbols)
            ? parsed.symbols.filter((item) => typeof item === 'string').slice(0, 200)
            : [];
    }
    catch (error) {
        return error.code === 'ENOENT' ? null : [];
    }
}
//# sourceMappingURL=shortlist.js.map