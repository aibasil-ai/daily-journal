import { zhTW } from '../../i18n/zh-TW'

export type MonthlyEntryCount = {
  date: string
  count: number
}

type CalendarViewProps = {
  month: string
  todayMonth?: string
  counts: MonthlyEntryCount[]
  onMonthChange: (month: string) => void
  onSelectDate: (date: string) => void
}

export function CalendarView({ month, todayMonth = localMonth(), counts, onMonthChange, onSelectDate }: CalendarViewProps) {
  const { year, monthNumber } = parseMonth(month)
  const countByDate = new Map(counts.map(({ date, count }) => [date, count]))
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const monthEntryCount = counts.reduce((total, { count }) => total + count, 0)
  const trailingEmptyDays = (7 - ((firstWeekday + daysInMonth) % 7)) % 7
  const weekdays = [zhTW.calendar.weekdays[6], ...zhTW.calendar.weekdays.slice(0, -1)]

  return (
    <section className="calendar-view" aria-labelledby="calendar-heading">
      <header className="calendar-page-header">
        <div className="calendar-page-header__title">
          <h2 id="calendar-heading">{zhTW.calendar.monthCalendar(month)}</h2>
          <p>本月共有 {monthEntryCount} 篇記事</p>
        </div>
        <div className="calendar-page-controls" aria-label="月份控制">
          <button type="button" className="calendar-page-controls__arrow" aria-label={zhTW.calendar.previousMonth} onClick={() => onMonthChange(addMonths(month, -1))}>
            <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <button type="button" className="calendar-page-controls__today" onClick={() => onMonthChange(todayMonth)}>今天</button>
          <button type="button" className="calendar-page-controls__arrow" aria-label={zhTW.calendar.nextMonth} onClick={() => onMonthChange(addMonths(month, 1))}>
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      </header>
      <div className="calendar-view__grid">
        <div className="calendar-view__weekdays" aria-hidden="true">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-view__days">
          {Array.from({ length: firstWeekday }, (_, index) => <span className="calendar-view__empty" key={`empty-before-${index}`} />)}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1
            const date = `${month}-${String(day).padStart(2, '0')}`
            const count = countByDate.get(date) ?? 0
            return (
              <button type="button" className="calendar-view__day" key={date} aria-label={zhTW.calendar.dateSummary(date, count)} onClick={() => void onSelectDate(date)}>
                <span className="calendar-view__date" aria-hidden="true">{day}</span>
                {count > 0 && <span className="calendar-view__count" aria-hidden="true">{zhTW.calendar.entryCount(count)}</span>}
              </button>
            )
          })}
          {Array.from({ length: trailingEmptyDays }, (_, index) => <span className="calendar-view__empty" key={`empty-after-${index}`} />)}
        </div>
      </div>
    </section>
  )
}

function localMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseMonth(month: string): { year: number; monthNumber: number } {
  const matched = /^(\d{4})-(\d{2})$/.exec(month)
  if (!matched) throw new Error(zhTW.calendar.invalidMonth)

  const year = Number(matched[1])
  const monthNumber = Number(matched[2])
  if (monthNumber < 1 || monthNumber > 12) throw new Error(zhTW.calendar.invalidMonth)
  return { year, monthNumber }
}

function addMonths(month: string, offset: number): string {
  const { year, monthNumber } = parseMonth(month)
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
