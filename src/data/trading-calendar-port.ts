import { addDays, isTradeDay } from '../core/calendar.js'

/** Trading-day source. Dates are ISO `YYYY-MM-DD`; adapters convert at the edge. */
export interface TradingCalendarPort {
  readonly source: 'ftshare' | 'fallback'
  isTradingDay(date: string): Promise<boolean>
  nextTradingDay(date: string): Promise<string>
  tradingDays(from: string, to: string): Promise<string[]>
}

/** Weekday fallback used while FTShare is absent or failing. */
export class WeekdayTradingCalendar implements TradingCalendarPort {
  readonly source = 'fallback' as const

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
