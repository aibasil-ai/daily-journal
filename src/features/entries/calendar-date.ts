export type CalendarMode = 'day' | 'week' | 'month'

export type CalendarDateRange = {
  from: string
  to: string
}

export const MIN_CALENDAR_ANCHOR_DATE = '0000-01-01'
export const MAX_CALENDAR_ANCHOR_DATE = '9999-12-31'
export const MIN_CALENDAR_WEEK_ANCHOR_DATE = '0000-01-03'
export const MAX_CALENDAR_WEEK_ANCHOR_DATE = '9999-12-26'

const WEEKDAYS = [
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六',
] as const

export function addCalendarDays(date: string, amount: number): string {
  const parsed = parseCalendarDate(date)
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return toCalendarDate(parsed)
}

export function getCalendarDateRange(mode: CalendarMode, anchorDate: string): CalendarDateRange {
  assertCalendarAnchorDate(mode, anchorDate)
  if (mode === 'day') return { from: anchorDate, to: anchorDate }
  if (mode === 'week') {
    const parsed = parseCalendarDate(anchorDate)
    const offsetFromMonday = (parsed.getUTCDay() + 6) % 7
    const from = addCalendarDays(anchorDate, -offsetFromMonday)
    return { from, to: addCalendarDays(from, 6) }
  }

  const { year, month } = calendarDateParts(anchorDate)
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  return {
    from: `${prefix}-01`,
    to: `${prefix}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
  }
}

export function shiftCalendarAnchorDate(
  mode: CalendarMode,
  anchorDate: string,
  direction: -1 | 1,
): string {
  assertCalendarAnchorDate(mode, anchorDate)
  const { min, max } = calendarAnchorBounds(mode)
  if (mode === 'day') {
    if ((direction < 0 && anchorDate === min) || (direction > 0 && anchorDate === max)) return anchorDate
    return keepAnchorWhenOutsideBounds(mode, anchorDate, addCalendarDays(anchorDate, direction))
  }
  if (mode === 'week') {
    const range = getCalendarDateRange(mode, anchorDate)
    if ((direction < 0 && range.from === min) || (direction > 0 && range.to === max)) return anchorDate
    return keepAnchorWhenOutsideBounds(mode, anchorDate, addCalendarDays(anchorDate, direction * 7))
  }

  const { year, month, day } = calendarDateParts(anchorDate)
  const targetIndex = year * 12 + month - 1 + direction
  if (targetIndex < 0 || targetIndex > 9999 * 12 + 11) return anchorDate
  const targetYear = Math.floor(targetIndex / 12)
  const targetMonth = targetIndex - targetYear * 12 + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return keepAnchorWhenOutsideBounds(mode, anchorDate, formatCalendarDate(targetYear, targetMonth, targetDay))
}

export function clampCalendarAnchorDate(mode: CalendarMode, date: string): string {
  const { min, max } = calendarAnchorBounds(mode)
  if (date < min) return min
  if (date > max) return max
  return date
}

export function listCalendarDates(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    dates.push(date)
    if (date === to) break
  }
  return dates
}

export function formatCalendarPeriodTitle(mode: CalendarMode, anchorDate: string): string {
  assertCalendarAnchorDate(mode, anchorDate)
  const anchor = calendarDateParts(anchorDate)
  if (mode === 'day') {
    return `${anchor.year}年${anchor.month}月${anchor.day}日 ${formatCalendarWeekday(anchorDate)}`
  }
  if (mode === 'month') return `${anchor.year}年${anchor.month}月`

  const { from, to } = getCalendarDateRange('week', anchorDate)
  const start = calendarDateParts(from)
  const end = calendarDateParts(to)
  if (start.year === end.year) {
    return `${start.year}年${start.month}月${start.day}日－${end.month}月${end.day}日`
  }
  return `${start.year}年${start.month}月${start.day}日－${end.year}年${end.month}月${end.day}日`
}

export function formatCalendarWeekday(date: string): string {
  return WEEKDAYS[parseCalendarDate(date).getUTCDay()]
}

export function formatCalendarMonthDay(date: string): string {
  const { month, day } = calendarDateParts(date)
  return `${month}月${day}日`
}

function calendarDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function parseCalendarDate(date: string): Date {
  const { year, month, day } = calendarDateParts(date)
  const parsed = new Date(0)
  parsed.setUTCFullYear(year, month - 1, day)
  parsed.setUTCHours(0, 0, 0, 0)
  return parsed
}

function toCalendarDate(date: Date): string {
  return formatCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function formatCalendarDate(year: number, month: number, day: number): string {
  if (year < 0 || year > 9999) throw new RangeError('日曆日期超出四位數年份範圍。')
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function assertCalendarAnchorDate(mode: CalendarMode, date: string): void {
  const { min, max } = calendarAnchorBounds(mode)
  if (date < min || date > max) {
    throw new RangeError('日曆焦點日期超出支援範圍。')
  }
}

function keepAnchorWhenOutsideBounds(mode: CalendarMode, anchorDate: string, candidate: string): string {
  const { min, max } = calendarAnchorBounds(mode)
  return candidate < min || candidate > max
    ? anchorDate
    : candidate
}

function calendarAnchorBounds(mode: CalendarMode): { min: string; max: string } {
  return mode === 'week'
    ? { min: MIN_CALENDAR_WEEK_ANCHOR_DATE, max: MAX_CALENDAR_WEEK_ANCHOR_DATE }
    : { min: MIN_CALENDAR_ANCHOR_DATE, max: MAX_CALENDAR_ANCHOR_DATE }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}