/**
 * Data-source state for the panel header.
 *
 * The panel must be able to say which of four worlds it is in — key configured,
 * anonymous free tier, no FTShare service at all, or a key that cannot be used
 * — without reading the key itself. This module only calls the settings
 * service's `describe()` (configured flag, source, last validation); it never
 * resolves the secret, never writes settings and never goes upstream.
 * @module @dsh-ft/dsh-fft-paper-trading/service/data-source
 */

import type { DataProblem, DataProblemReason, DataSourceStatus } from '../contract.js'

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

/** API-key and authentication codes: the key itself is missing or rejected. */
const AUTH_CODES = new Set([
  '401', 'unauthorized', 'auth_required', 'invalid_key', 'invalid_api_key',
  'upstream_unauthenticated', 'api_key_header_missing', 'api_key_malformed',
])

/** Plan/permission codes: the key works but the subscription does not cover it. */
const PLAN_CODES = new Set([
  '403', 'forbidden', 'route_not_allowed', 'capability_limited', 'permission_denied',
  'insufficient_permissions', 'subscription_required',
])

/** Codes that mean "too many requests today" rather than an outage. */
const QUOTA_CODES = new Set(['insufficient_quota', 'quota_exceeded', 'quota_exhausted', '429', 'rate_limited'])

/** Codes that mean the network or the gateway is temporarily down. */
const NETWORK_CODES = new Set([
  'timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'fetch_failed',
  '502', '503', '504',
])

/**
 * Suffix the shared FTShare bundle appends to a spent anonymous quota.
 *
 * `UPSTREAM_UNAVAILABLE` is deliberately the same code the gateway returns for
 * a real outage, so the code alone cannot tell them apart. This literal copies
 * the bundle's `FTSHARE_QUOTA_NOTICE`; if that wording changes, update it here.
 */
const QUOTA_SENTINEL = '免费配额用尽'

/** Longest upstream cause kept in a problem record. */
const MESSAGE_MAX_LENGTH = 160

function trimMessage(text: string | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat === '') return '行情暂不可用'
  return flat.length <= MESSAGE_MAX_LENGTH ? flat : `${flat.slice(0, MESSAGE_MAX_LENGTH)}…`
}

/** Map one failed market-data result to the reason the banner acts on. */
export function classifyDataProblem(
  input: { state: string; notice?: string; noticeCode?: string },
  at: string,
): DataProblem | undefined {
  if (input.state === 'ok') return undefined
  const code = input.noticeCode?.toLowerCase()
  const text = input.notice ?? ''
  let reason: DataProblemReason
  if (code !== undefined && AUTH_CODES.has(code)) reason = 'invalid-key'
  else if (code !== undefined && PLAN_CODES.has(code)) reason = 'plan-denied'
  else if (code !== undefined && QUOTA_CODES.has(code)) reason = 'quota'
  else if (text.includes(QUOTA_SENTINEL)) reason = 'quota'
  else if (code !== undefined && NETWORK_CODES.has(code)) reason = 'network'
  // `denied` is the FTShare layer's permission verdict; without a specific
  // code it still means "the plan/credential does not cover this interface".
  else if (input.state === 'denied') reason = 'plan-denied'
  else reason = 'upstream'
  return { reason, message: trimMessage(input.notice), at }
}
