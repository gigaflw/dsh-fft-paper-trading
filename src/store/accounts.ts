/**
 * Registry of paper-trading accounts.
 *
 * One JSON file next to the ledgers (`$DSH_HOME/paper-trading/accounts.json`)
 * owns the account list. Ledgers stay where they are: an account is just a
 * directory name, so the registry never rewrites trading data and an old
 * installation needs no migration.
 *
 * The registry deliberately knows nothing about sessions, models or owners —
 * this plugin provides ledgers and tools, and every caller addresses an account
 * by id or display name. Display names may repeat; `id` is the reliable handle.
 *
 * The file is rewritten atomically (temp file + rename) and every mutation goes
 * through one Promise queue, mirroring {@link AccountRepo}'s single-writer rule.
 * @module @dsh-ft/dsh-fft-paper-trading/store/accounts
 */

import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountKind, AccountMeta, AccountsView } from '../contract.js'
import { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } from '../contract.js'
import { FUTURES_ACCOUNT_ID } from '../futures-contract.js'
import { PaperError } from '../service/errors.js'
import { paperRoot } from './paths.js'
import { writeFileAtomic } from './atomic-file.js'

const REGISTRY_FILE = 'accounts.json'
const REGISTRY_VERSION = 3
/** Keeps one host's tick loop and the panel's account picker bounded. */
export const MAX_ACCOUNTS_PER_KIND = 20
export const ACCOUNT_NAME_MAX = 16
export const DEFAULT_TICK_MS = 5_000
const MIN_TICK_MS = 1_000
const MAX_TICK_MS = 300_000

/** On-disk shape. Unknown fields are ignored; a broken file must not block trading. */
interface AccountsFile {
  version: number
  updatedAt: string
  tickMs: number
  accounts: AccountMeta[]
}

export interface AccountRegistryOptions {
  home: string
  now?: () => Date
  logger?: { warn(message: string): void }
  /** Limits used only by tests. */
  limits?: { maxPerKind?: number; tickMs?: { min?: number; max?: number } }
}

export class AccountRegistry {
  private state: AccountsFile | undefined
  private loading: Promise<AccountsFile> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date
  private readonly file: string
  private readonly root: string

  constructor(private readonly options: AccountRegistryOptions) {
    this.now = options.now ?? (() => new Date())
    this.root = paperRoot(options.home)
    this.file = join(this.root, REGISTRY_FILE)
  }

  /** Absolute path of the registry file, for diagnostics and export. */
  get filePath(): string {
    return this.file
  }

  /** Load (once) and return the live view. */
  private async ready(): Promise<AccountsFile> {
    if (this.state !== undefined) return this.state
    if (this.loading === undefined) {
      this.loading = this.load().catch(error => {
        // A transient read failure must not poison the instance for the rest
        // of the session: drop the cached promise so the next call retries.
        this.loading = undefined
        throw error
      })
    }
    return this.loading
  }

  private async load(): Promise<AccountsFile> {
    let parsed: unknown
    let readable = true
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (error instanceof SyntaxError) this.options.logger?.warn(`paper-trading: ignoring unreadable ${REGISTRY_FILE}`)
      parsed = undefined
      readable = code === 'ENOENT'
    }
    const state = this.normalise(parsed)
    const discovered = await this.discover(state)
    if (discovered) state.updatedAt = this.now().toISOString()
    const changed = !readable || discovered || (parsed as AccountsFile | undefined)?.version !== REGISTRY_VERSION
    if (changed) await this.save(state)
    this.state = state
    return state
  }

  /** Merge a persisted file over the defaults; never trust its shape. */
  private normalise(persisted: unknown): AccountsFile {
    const input = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<AccountsFile>
    const accounts: AccountMeta[] = []
    for (const raw of Array.isArray(input.accounts) ? input.accounts : []) {
      const meta = normaliseMeta(raw)
      if (meta !== undefined && !accounts.some(item => item.id === meta.id)) accounts.push(meta)
    }
    for (const [id, name, kind] of [
      [DEFAULT_ACCOUNT_ID, '默认账户', 'stock'],
      [FUTURES_ACCOUNT_ID, '期货账户', 'futures'],
    ] as const) {
      if (!accounts.some(item => item.id === id)) {
        accounts.push({ id, kind, name, createdAt: this.now().toISOString(), hidden: false, locked: false })
      }
    }
    return {
      version: REGISTRY_VERSION,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : this.now().toISOString(),
      tickMs: clampInt(input.tickMs, this.options.limits?.tickMs?.min ?? MIN_TICK_MS, this.options.limits?.tickMs?.max ?? MAX_TICK_MS, DEFAULT_TICK_MS),
      accounts,
    }
  }

  /**
   * Register ledger directories the file does not know about: an old install
   * predates the registry, and a hand-made account directory should not vanish.
   */
  private async discover(state: AccountsFile): Promise<boolean> {
    let entries: string[]
    try {
      entries = await readdir(this.root)
    } catch {
      return false
    }
    let changed = false
    for (const entry of entries) {
      if (entry === 'accounts.json' || entry === 'shortlist.json' || entry === 'backups') continue
      if (state.accounts.some(item => item.id === entry)) {
        const known = state.accounts.find(item => item.id === entry) as AccountMeta
        if (known.missing === true) {
          known.missing = false
          changed = true
        }
        continue
      }
      try {
        await stat(join(this.root, entry, 'events.jsonl'))
      } catch {
        continue
      }
      const kind: AccountKind = entry === FUTURES_ACCOUNT_ID ? 'futures' : 'stock'
      state.accounts.push({ id: entry, kind, name: entry, createdAt: this.now().toISOString(), hidden: false, locked: false })
      changed = true
    }
    for (const meta of state.accounts) {
      if (meta.id === DEFAULT_ACCOUNT_ID || meta.id === FUTURES_ACCOUNT_ID) continue
      try {
        await stat(join(this.root, meta.id))
      } catch {
        if (meta.missing !== true) {
          meta.missing = true
          changed = true
        }
      }
    }
    return changed
  }

  private async save(state: AccountsFile): Promise<void> {
    await writeFileAtomic(this.file, `${JSON.stringify({ ...state, version: REGISTRY_VERSION }, null, 2)}\n`)
  }

  /** Serialise mutations the same way the ledger serialises appends. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async mutate(task: (state: AccountsFile) => void): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.ready()
      task(state)
      state.updatedAt = this.now().toISOString()
      await this.save(state)
    })
  }

  /** `includeHidden` keeps the picker clean but lets tooling see everything. */
  async view(options: { includeHidden?: boolean } = {}): Promise<AccountsView> {
    const state = await this.ready()
    const accounts = options.includeHidden === true ? state.accounts : state.accounts.filter(item => item.hidden !== true)
    return {
      accounts: accounts.map(meta => ({ ...meta })),
      defaultIds: { stock: DEFAULT_ACCOUNT_ID, futures: FUTURES_ACCOUNT_ID },
      tickMs: state.tickMs,
    }
  }

  /** Post-load lock flag; the service guard must not go stale on a copy. */
  lockedSync(id: string): boolean {
    return this.state?.accounts.some(item => item.id === id && item.locked === true) ?? false
  }

  async tickMs(): Promise<number> {
    return (await this.ready()).tickMs
  }

  /**
   * Resolve an account reference to its metadata.
   *
   * `undefined` means "the kind's default account", which keeps every caller
   * that predates multi-account working unchanged. An id always wins; a name
   * may be ambiguous because names are not unique, and ambiguity is an error
   * rather than a guess.
   */
  async resolve(reference: string | undefined, kind: AccountKind = 'stock'): Promise<AccountMeta> {
    const state = await this.ready()
    if (reference === undefined) return this.requireDefault(state, kind)
    if (reference.trim() === '') throw new PaperError('INVALID_ARGUMENT', '账户名不能为空')
    const byId = state.accounts.find(item => item.id === reference)
    if (byId !== undefined) return byId
    const byName = state.accounts.filter(item => item.kind === kind && item.name === reference)
    if (byName.length === 1) return byName[0] as AccountMeta
    if (byName.length > 1) {
      throw new PaperError('INVALID_ARGUMENT', `账户名「${reference}」不唯一，请改用账户 id：${byName.map(item => item.id).join('、')}`)
    }
    throw new PaperError('ACCOUNT_NOT_FOUND', `没有名为「${reference}」的账户`)
  }

  private requireDefault(state: AccountsFile, kind: AccountKind): AccountMeta {
    const id = kind === 'futures' ? FUTURES_ACCOUNT_ID : DEFAULT_ACCOUNT_ID
    const meta = state.accounts.find(item => item.id === id)
    if (meta === undefined) throw new PaperError('ACCOUNT_NOT_FOUND', `默认账户 ${id} 不存在`)
    return meta
  }

  async create(input: { name: string; kind?: AccountKind; initialCashCents?: number }): Promise<AccountMeta> {
    const kind = input.kind ?? 'stock'
    const name = validateName(input.name)
    let created: AccountMeta | undefined
    await this.mutate(state => {
      const live = state.accounts.filter(item => item.kind === kind)
      const limit = this.options.limits?.maxPerKind ?? MAX_ACCOUNTS_PER_KIND
      if (live.length >= limit) throw new PaperError('ACCOUNT_LIMIT', `账户数量已达上限 ${limit}`)
      created = {
        id: this.nextId(state),
        kind,
        name,
        createdAt: this.now().toISOString(),
        hidden: false,
        locked: false,
        ...(input.initialCashCents !== undefined ? { initialCashCents: Math.round(input.initialCashCents) } : {}),
      }
      state.accounts.push(created)
    })
    // Materialise the directory now: a registered account without a directory
    // would look "missing" until its ledger is first opened.
    await mkdir(join(this.root, (created as AccountMeta).id), { recursive: true })
    return { ...(created as AccountMeta) }
  }

  private nextId(state: AccountsFile): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const id = `acc-${Math.random().toString(36).slice(2, 8)}`
      if (!state.accounts.some(item => item.id === id)) return id
    }
    return `acc-${this.now().getTime().toString(36)}`
  }

  /** Change the display name only; the directory id never moves. */
  async rename(reference: string, name: string): Promise<AccountMeta> {
    const target = await this.resolve(reference)
    if (target.id === FUTURES_ACCOUNT_ID) {
      // The futures plane has a fixed panel and never reads the registry name,
      // so renaming it would only create misleading metadata.
      throw new PaperError('INVALID_ARGUMENT', '期货账户名称固定，不可改名')
    }
    const next = validateName(name)
    await this.mutate(state => {
      const meta = state.accounts.find(item => item.id === target.id) as AccountMeta
      meta.name = next
    })
    return { ...((await this.resolve(target.id)) as AccountMeta) }
  }

  /** Flip a boolean flag on one account; used by hide/lock and their inverses. */
  private async setFlag(reference: string, patch: Partial<Pick<AccountMeta, 'hidden' | 'locked'>>): Promise<AccountMeta> {
    const target = await this.resolve(reference)
    if (patch.hidden === true && (target.id === DEFAULT_ACCOUNT_ID || target.id === FUTURES_ACCOUNT_ID)) {
      // Hiding the default would leave the panel without a picker and no way
      // back from the UI; the default account stays visible.
      throw new PaperError('INVALID_ARGUMENT', `默认账户不能隐藏（${target.name}）`)
    }
    await this.mutate(state => {
      const meta = state.accounts.find(item => item.id === target.id) as AccountMeta
      Object.assign(meta, patch)
    })
    return { ...((await this.resolve(target.id)) as AccountMeta) }
  }

  hide(reference: string): Promise<AccountMeta> {
    return this.setFlag(reference, { hidden: true })
  }

  unhide(reference: string): Promise<AccountMeta> {
    return this.setFlag(reference, { hidden: false })
  }

  lock(reference: string): Promise<AccountMeta> {
    return this.setFlag(reference, { locked: true })
  }

  unlock(reference: string): Promise<AccountMeta> {
    return this.setFlag(reference, { locked: false })
  }
}

/** Trim and reject empty or over-long display names. Duplicates are allowed. */
function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new PaperError('INVALID_ARGUMENT', '账户名必须是字符串')
  const name = value.trim()
  if (name === '') throw new PaperError('INVALID_ARGUMENT', '账户名不能为空')
  if ([...name].length > ACCOUNT_NAME_MAX) throw new PaperError('INVALID_ARGUMENT', `账户名不能超过 ${ACCOUNT_NAME_MAX} 个字符`)
  return name
}

/** v1 wrote `archived` + bindings, v2 added the note; v3 dropped the note. Old fields are ignored. */
function normaliseMeta(raw: unknown): AccountMeta | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Partial<AccountMeta> & { archived?: unknown }
  if (typeof input.id !== 'string' || input.id === '') return undefined
  const kind: AccountKind = input.kind === 'futures' ? 'futures' : 'stock'
  const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim().slice(0, ACCOUNT_NAME_MAX) : input.id
  return {
    id: input.id,
    kind,
    name,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date(0).toISOString(),
    hidden: input.hidden === true || input.archived === true,
    locked: input.locked === true,
    ...(typeof input.initialCashCents === 'number' && Number.isFinite(input.initialCashCents) && input.initialCashCents > 0
      ? { initialCashCents: Math.round(input.initialCashCents) }
      : {}),
    ...(input.missing === true ? { missing: true } : {}),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Default starting cash for a brand-new account when the caller names no amount. */

export type { AccountsFile }
