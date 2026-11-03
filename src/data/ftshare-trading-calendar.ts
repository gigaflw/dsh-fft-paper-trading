import type { CalendarStatus } from '../contract.js'
import { addDays } from '../core/calendar.js'
import type { TradingCalendarPort } from './trading-calendar-port.js'
import { WeekdayTradingCalendar } from './trading-calendar-port.js'
import type { FtshareDataLike } from './ftshare-market-data.js'

/** First gap between two upstream attempts after a failure; doubles per failure. */
export const CALENDAR_RETRY_MS = 60_000

/** Ceiling of the failure backoff. */
export const CALENDAR_RETRY_MAX_MS = 600_000

/** Longest reason kept for display; upstream errors can be paragraphs. */
const REASON_MAX_LENGTH = 120

const SHANGHAI_OFFSET_MS = 8 * 3_600_000

/** Trading days as `YYYY-MM-DD`, ascending. */
type DayList = string[]

/** One calendar year's worth of answers, as the adapter remembers them. */
interface YearEntry {
  source: 'ftshare' | 'fallback'
  /** Present when `source` is `ftshare`. */
  days?: DayList
  /** Why the weekday estimate is in use; present when `source` is `fallback`. */
  reason?: string
  /** ISO-8601 of the attempt that produced this entry. */
  checkedAt: string
  /** When the last attempt failed, for the backoff. */
  failedAt?: number
  /** Consecutive failures, so the backoff can double. */
  failures: number
  /** A quota/credential answer: never retried again this natural day. */
  final: boolean
}

function apiDate(date: string): number {
  return Number(date.replaceAll('-', ''))
}

function isoDate(value: unknown): string | undefined {
  const digits = String(value ?? '').trim()
  if (!/^\d{8}$/.test(digits)) return undefined
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= REASON_MAX_LENGTH ? flat : `${flat.slice(0, REASON_MAX_LENGTH)}…`
}

/**
 * Whether an answer is a quota answer, where retrying only burns the window.
 *
 * The gateway reports its daily ceiling as `UPSTREAM_UNAVAILABLE` with the quota
 * in the text (`最近 1 天最多访问 500 次`), so the code alone does not identify it.
 */
function isQuota(text: string, retryable: boolean | undefined): boolean {
  if (retryable === false && /UPSTREAM_UNAVAILABLE/u.test(text)) return true
  return /(最多访问|访问次数|调用次数|频率|限流|配额|quota|rate limit|too many requests)/iu.test(text)
}

/** The years a `YYYY-MM-DD` range touches, ascending. */
function yearsOf(from: string, to: string): string[] {
  const first = Number(from.slice(0, 4))
  const last = Number(to.slice(0, 4))
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [from.slice(0, 4)]
  const years: string[] = []
  for (let year = first; year <= last && years.length < 8; year += 1) years.push(String(year))
  return years
}

export interface FtshareTradingCalendarOptions {
  /** Clock for the year cache, the backoff and the natural-day reset. */
  now?: () => Date
  /** First retry gap after a failure; defaults to {@link CALENDAR_RETRY_MS}. */
  retryMs?: number
  /** Backoff ceiling; defaults to {@link CALENDAR_RETRY_MAX_MS}. */
  retryMaxMs?: number
}

/**
 * Trading calendar over FTShare's `ft_v1_time_trading_calendar`.
 *
 * The upstream schema takes YYYYMMDD integers and returns an integer
 * `trade_dates` array; this adapter is the only place that converts them.
 *
 * **Cached per calendar year, not per query.** An exchange calendar changes once
 * a year, so the first question fetches the whole year once and every later
 * question — any range, any caller, the 5 s match tick included — is answered
 * from that memory. The previous version cached per exact `from:to` range and
 * re-asked upstream after every failure, which let two 5 s schedulers issue
 * ~120 calls/hour against an endpoint with a daily quota.
 *
 * **Failures are remembered too.** A failure falls back to weekdays, records
 * why, and suppresses further attempts with an exponential backoff (1, 2, 4 …
 * ≤ {@link CALENDAR_RETRY_MAX_MS}). A quota answer is not retried at all until
 * the next Shanghai natural day, because retrying it only spends what is left of
 * the window. Concurrent ticks share one in-flight question.
 *
 * The degradation is never silent: {@link source} stays `fallback` and
 * {@link status} carries the upstream reason.
 */
export class FtshareTradingCalendar implements TradingCalendarPort {
  private readonly fallback = new WeekdayTradingCalendar()
  private readonly now: () => Date
  private readonly retryMs: number
  private readonly retryMaxMs: number
  /** `YYYY` → that year's answer. */
  private readonly years = new Map<string, YearEntry>()
  /** `YYYY` → in-flight upstream question, so parallel ticks share one call. */
  private readonly inflight = new Map<string, Promise<DayList>>()
  private latest: YearEntry | undefined

  constructor(private readonly service: FtshareDataLike, options: FtshareTradingCalendarOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.retryMs = options.retryMs ?? CALENDAR_RETRY_MS
    this.retryMaxMs = options.retryMaxMs ?? CALENDAR_RETRY_MAX_MS
  }

  /** Which source answered the latest calendar question. */
  get source(): 'ftshare' | 'fallback' {
    return this.latest?.source ?? 'fallback'
  }

  get status(): CalendarStatus {
    const latest = this.latest
    if (latest === undefined) return this.fallback.status
    return {
      source: latest.source,
      ...latest.reason !== undefined ? { reason: latest.reason } : {},
      checkedAt: latest.checkedAt,
    }
  }

  async tradingDays(from: string, to: string): Promise<string[]> {
    const answers = await Promise.all(yearsOf(from, to).map(year => this.daysOfYear(year)))
    return answers.flat().filter(day => day >= from && day <= to).sort()
  }

  async isTradingDay(date: string): Promise<boolean> {
    return (await this.tradingDays(date, date)).includes(date)
  }

  async nextTradingDay(date: string): Promise<string> {
    const days = await this.tradingDays(addDays(date, 1), addDays(date, 30))
    return days[0] ?? (await this.fallback.nextTradingDay(date))
  }

  /**
   * Answer one calendar year from memory, upstream, or the weekday estimate.
   * @param year - `YYYY`.
   * @returns That year's trading days; empty only if the estimate is empty too.
   */
  private async daysOfYear(year: string): Promise<DayList> {
    const entry = this.years.get(year)
    if (entry?.source === 'ftshare' && entry.days !== undefined) return entry.days
    if (entry?.source === 'fallback' && this.suppressed(entry)) return await this.estimate(year)
    const pending = this.inflight.get(year)
    if (pending !== undefined) return pending
    const question = this.ask(year).finally(() => { this.inflight.delete(year) })
    this.inflight.set(year, question)
    return question
  }

  /** Whether a failed year must not be asked again yet. */
  private suppressed(entry: YearEntry): boolean {
    const now = this.now()
    // A quota answer is final until the next Shanghai natural day: asking again
    // inside the same window only spends calls the window no longer has.
    if (entry.final) return this.naturalDay(now) <= this.naturalDayOf(entry.checkedAt)
    if (entry.failedAt === undefined) return false
    return now.getTime() - entry.failedAt < this.retryGap(entry.failures)
  }

  /** Exponential backoff by consecutive failures, capped at {@link retryMaxMs}. */
  private retryGap(failures: number): number {
    return Math.min(this.retryMs * 2 ** Math.max(0, failures - 1), this.retryMaxMs)
  }

  /** `/^YYYY-MM-DD/` of a natural day in Shanghai. */
  private naturalDay(now: Date): string {
    return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
  }

  private naturalDayOf(iso: string | undefined): string {
    return iso === undefined ? '' : this.naturalDay(new Date(iso))
  }

  private async estimate(year: string): Promise<DayList> {
    return await this.fallback.tradingDays(`${year}-01-01`, `${year}-12-31`)
  }

  /** Ask upstream for the whole year once, then remember the outcome. */
  private async ask(year: string): Promise<DayList> {
    const now = this.now()
    const from = `${year}-01-01`
    const to = `${year}-12-31`
    const outcome = await this.fetch(from, to)
    if (outcome.ok) {
      const entry: YearEntry = { source: 'ftshare', days: outcome.days, checkedAt: now.toISOString(), failures: 0, final: false }
      this.years.set(year, entry)
      this.latest = entry
      return outcome.days
    }
    const previous = this.years.get(year)
    const failures = (previous?.source === 'fallback' ? previous.failures : 0) + 1
    const reason = reasonOf(outcome.error)
    const entry: YearEntry = {
      source: 'fallback',
      reason: outcome.final ? `${reason}（本自然日不再重试）` : reason,
      checkedAt: now.toISOString(),
      failedAt: now.getTime(),
      failures,
      final: outcome.final,
    }
    this.years.set(year, entry)
    this.latest = entry
    return await this.estimate(year)
  }

  /** One upstream question; classifies the answer without touching the cache. */
  private async fetch(from: string, to: string): Promise<{ ok: true; days: DayList } | { ok: false; error: unknown; final: boolean }> {
    try {
      const result = await this.service.call('ft_v1_time_trading_calendar', {
        market: 'cn',
        start_date: apiDate(from),
        end_date: apiDate(to),
      })
      if (result.state === 'denied' || result.state === 'failed') {
        const text = `${result.notice?.code ?? ''} ${result.notice?.message ?? result.state}`.trim()
        return {
          ok: false,
          error: new Error(result.notice?.message ?? result.state),
          // The quota text is the only quota fact this port carries; `retryable`
          // is passed through only by adapters that keep it.
          final: result.state === 'denied' || isQuota(text, undefined),
        }
      }
      const rows = Array.isArray(result.rows) ? result.rows : []
      const raw = rows[0]?.trade_dates
      const days = (Array.isArray(raw) ? raw : [])
        .map(isoDate)
        .filter((value): value is string => value !== undefined)
        .sort()
      if (days.length === 0) {
        // An empty year is not an answer: caching it would read as "no trading
        // day ever" and freeze settlement, so it counts as a failure instead.
        return { ok: false, error: new Error(`上游未返回 ${from.slice(0, 4)} 年交易日历`), final: false }
      }
      return { ok: true, days }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      return { ok: false, error, final: isQuota(text, undefined) }
    }
  }
}
