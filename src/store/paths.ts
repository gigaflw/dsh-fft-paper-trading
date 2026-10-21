import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME_ENV = 'DSH_HOME'
const DSH_HOME_DIR = '.dsh'

/** Resolve `$DSH_HOME` with the same semantics as the host: env, then `~/.dsh`. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DSH_HOME_ENV]?.trim()
  if (configured !== undefined && configured !== '') {
    return configured.startsWith('~') ? join(homedir(), configured.slice(1)) : configured
  }
  return join(homedir(), DSH_HOME_DIR)
}

export function paperRoot(home = resolveDshHome()): string {
  return join(home, 'paper-trading')
}

export function accountDir(home: string, accountId: string): string {
  return join(paperRoot(home), accountId)
}

export function eventsPath(home: string, accountId: string): string {
  return join(accountDir(home, accountId), 'events.jsonl')
}

export function backupsDir(home: string, accountId: string): string {
  return join(accountDir(home, accountId), 'backups')
}
