import type { CalendarStatus } from '../contract.js'
import { addDays, isTradeDay } from '../core/calendar.js'

/** Trading-day source. Dates are ISO `YYYY-MM-DD`; adapters convert at the edge. */
export interface TradingCalendarPort {
  /** Short form of {@link status}, kept for existing callers. */
  readonly source: 'ftshare' | 'fallback'
  /** Source plus the degradation reason, for the panel and the agent summary. */
  readonly status: CalendarStatus
  isTradingDay(date: string): Promise<boolean>
  nextTradingDay(date: string): Promise<string>
  tradingDays(from: string, to: string): Promise<string[]>
}

/** Weekday fallback used while FTShare is absent or failing. */
export class WeekdayTradingCalendar implements TradingCalendarPort {
  readonly source = 'fallback' as const
  readonly status: CalendarStatus

  /**
   * @param reason - why the weekday approximation is in use, shown in the UI.
   */
  constructor(reason = '未接入 FTShare 交易日历') {
    this.status = { source: 'fallback', reason }
  }

  async isTradingDay(date: string): Promise<boolean> {
    return isTradeDay(date)
  }

  async tradingDays(from: string, to: string): Promise<string[]> {
    const days: string[] = []
    for (let cursor = from; cursor <= to && days.length < 400; cursor = addDays(cursor, 1)) {
      if (isTradeDay(cursor)) days.push(cursor)
    }
    return days
  }

  async nextTradingDay(date: string): Promise<string> {
    let cursor = addDays(date, 1)
    for (let i = 0; i < 30; i += 1) {
      if (isTradeDay(cursor)) return cursor
      cursor = addDays(cursor, 1)
    }
    return addDays(date, 1)
  }
}
