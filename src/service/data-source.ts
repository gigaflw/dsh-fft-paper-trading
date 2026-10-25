/**
 * Data-source state for the panel header.
 *
 * The panel must be able to say which of four worlds it is in — key configured,
 * anonymous free tier, no FTShare service at all, or a key that cannot be used
 * — without reading the key itself. This module only calls the settings
 * service's `describe()` (configured flag, source, last validation); it never
 * resolves the secret, never writes settings and never goes upstream.
 * @module @ft/dsh-fft-paper-trading/service/data-source
 */

import type { DataSourceStatus } from '../contract.js'

/** Structural slice of `ctx.ftshareSettings.apiKey`; no runtime import across packages. */
export interface FtshareApiKeyLike {
  describe?(): Promise<unknown>
}

/** Structural slice of the shared FTShare settings service. */
export interface FtshareSettingsLike {
  apiKey?: FtshareApiKeyLike
}

export interface DataSourceProbeInput {
  /** Whether `ctx.ftshareData` is attached (i.e. the FTShare plugin is installed). */
  dataService: boolean
  settings?: FtshareSettingsLike
}

/** Validation statuses that mean the configured key itself is unusable. */
const UNUSABLE_KEY_STATES = new Set(['auth_failed', 'auth_required'])

/** Validation statuses that say nothing useful; a configured key stays configured. */
const QUIET_STATES = new Set(['available', 'not_run'])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Read `validation.apiKey` from a settings `describe()` payload. */
function apiKeyProbe(described: Record<string, unknown>): { status?: string; message?: string } {
  const validation = asRecord(described.validation)
  const probe = asRecord(validation?.apiKey)
  return { status: asText(probe?.status), message: asText(probe?.message) }
}

/**
 * Probe the data source without touching the credential value.
 * @param input - whether the data service is attached plus the settings handle.
 * @returns the four-state status for the panel header.
 */
export async function probeDataSource(input: DataSourceProbeInput): Promise<DataSourceStatus> {
  if (!input.dataService) return { state: 'none' }
  const describe = input.settings?.apiKey?.describe
  if (typeof describe !== 'function') {
    return { state: 'invalid', message: '无法读取 FTShare Key 状态' }
  }
  let status: DataSourceStatus
  try {
    const described = asRecord(await describe())
    if (described === undefined) {
      status = { state: 'invalid', message: '无法读取 FTShare Key 状态' }
    } else if (described.configured !== true) {
      status = { state: 'free' }
    } else {
      const probe = apiKeyProbe(described)
      if (probe.status !== undefined && UNUSABLE_KEY_STATES.has(probe.status)) {
        status = { state: 'invalid', ...(probe.message === undefined ? {} : { message: probe.message }) }
      } else if (probe.status !== undefined && !QUIET_STATES.has(probe.status)) {
        // The key is configured, but its last check did not come back clean
        // (plan limit, quota, outage). Keep the state honest and explain it.
        status = { state: 'configured', ...(probe.message === undefined ? {} : { message: probe.message }) }
      } else {
        status = { state: 'configured' }
      }
    }
  } catch {
    status = { state: 'invalid', message: '无法读取 FTShare Key 状态' }
  }
  return status
}
