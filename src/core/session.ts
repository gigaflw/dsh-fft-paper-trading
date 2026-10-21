import type { OrderType, SessionPhase } from '../contract.js'
import { tradeDateOf } from './calendar.js'

/** A-share session table, Asia/Shanghai. Auctions are separate phases. */
export interface SessionWindow {
  phase: SessionPhase
  /** Minutes since midnight. */
  start: number
  end: number
  canSubmitMarket: boolean
  canSubmitLimit: boolean
  canMatch: boolean
}

export const SESSION_WINDOWS: readonly SessionWindow[] = [
  { phase: 'pre_open', start: 9 * 60 + 15, end: 9 * 60 + 30, canSubmitMarket: false, canSubmitLimit: true, canMatch: false },
  { phase: 'continuous_am', start: 9 * 60 + 30, end: 11 * 60 + 30, canSubmitMarket: true, canSubmitLimit: true, canMatch: true },
  { phase: 'lunch', start: 11 * 60 + 30, end: 13 * 60, canSubmitMarket: false, canSubmitLimit: true, canMatch: false },
  { phase: 'continuous_pm', start: 13 * 60, end: 14 * 60 + 57, canSubmitMarket: true, canSubmitLimit: true, canMatch: true },
  { phase: 'auction_close', start: 14 * 60 + 57, end: 15 * 60, canSubmitMarket: false, canSubmitLimit: true, canMatch: false },
  { phase: 'closed', start: 15 * 60, end: 24 * 60, canSubmitMarket: false, canSubmitLimit: true, canMatch: false },
  { phase: 'closed', start: 0, end: 9 * 60 + 15, canSubmitMarket: false, canSubmitLimit: true, canMatch: false },
]

const SHANGHAI = 'Asia/Shanghai'
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHANGHAI,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Shanghai date plus minutes since midnight for an ISO timestamp. */
export function shanghaiClock(iso: string): { date: string; minutes: number } {
  const time = Date.parse(iso)
  const value = Number.isNaN(time) ? new Date() : new Date(time)
  const parts = clockFormatter.formatToParts(value)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return { date: tradeDateOf(Number.isNaN(time) ? new Date().toISOString() : iso), minutes: hour * 60 + minute }
}

export function windowOf(phase: SessionPhase): SessionWindow {
  const found = SESSION_WINDOWS.find(window => window.phase === phase)
  if (found === undefined) throw new Error(`unknown session phase: ${phase}`)
  return found
}

export function sessionPhaseAt(iso: string): SessionPhase {
  const { minutes } = shanghaiClock(iso)
  for (const window of SESSION_WINDOWS) {
    if (minutes >= window.start && minutes < window.end) return window.phase
  }
  return 'closed'
}

export function canMatch(phase: SessionPhase): boolean {
  return windowOf(phase).canMatch
}

export function canSubmit(phase: SessionPhase, type: OrderType): boolean {
  const window = windowOf(phase)
  return type === 'market' ? window.canSubmitMarket : window.canSubmitLimit
}

/** ISO timestamp for a Shanghai wall-clock minute on a `YYYY-MM-DD` date. */
export function isoAtShanghai(date: string, minutes: number): string {
  const base = Date.parse(`${date}T00:00:00+08:00`)
  return new Date(base + minutes * 60_000).toISOString()
}

/** Next session boundary after `iso`; may be a non-trading day, which the caller resolves. */
export function nextBoundary(iso: string): { at: string; phase: SessionPhase } {
  const { date, minutes } = shanghaiClock(iso)
  const phase = sessionPhaseAt(iso)
  const starts: Array<{ at: number; phase: SessionPhase }> = [
    { at: 9 * 60 + 15, phase: 'pre_open' },
    { at: 9 * 60 + 30, phase: 'continuous_am' },
    { at: 11 * 60 + 30, phase: 'lunch' },
    { at: 13 * 60, phase: 'continuous_pm' },
    { at: 14 * 60 + 57, phase: 'auction_close' },
    { at: 15 * 60, phase: 'closed' },
  ]
  const upcoming = starts.find(item => item.at > minutes)
  if (upcoming !== undefined) return { at: isoAtShanghai(date, upcoming.at), phase: upcoming.phase }
  const next = new Date(Date.parse(`${date}T00:00:00+08:00`) + 86_400_000)
  const nextDate = tradeDateOf(next.toISOString())
  return { at: isoAtShanghai(nextDate, 9 * 60 + 15), phase: 'pre_open' }
}
