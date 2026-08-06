import { zhTW } from '../../i18n/zh-TW'

export type MonthlyEntryCount = {
  date: string
  count: number
}

type CalendarViewProps = {
  month: string
  counts: MonthlyEntryCount[]
  onMonthChange: (month: string) => void
  onSelectDate: (date: string) => void
}

export function CalendarView({ month, counts, onMonthChange, onSelectDate }: CalendarViewProps) {
  const { year, monthNumber } = parseMonth(month)
  const countByDate = new Map(counts.map(({ date, count }) => [date, count]))
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return (
    <section className="calendar-view" aria-labelledby="calendar-heading">
      <div className="calendar-view__header">
        <button type="button" className="button--secondary" onClick={() => onMonthChange(addMonths(month, -1))}>{zhTW.calendar.previousMonth}</button>
        <h2 id="calendar-heading">{zhTW.calendar.monthCalendar(month)}</h2>
        <button type="button" className="button--secondary" onClick={() => onMonthChange(addMonths(month, 1))}>{zhTW.calendar.nextMonth}</button>
      </div>
      <div className="calendar-view__weekdays" aria-hidden="true">
        {zhTW.calendar.weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="calendar-view__days">
        {Array.from({ length: firstWeekday }, (_, index) => <span className="calendar-view__empty" key={`empty-${index}`} />)}
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
      </div>
    </section>
  )
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
