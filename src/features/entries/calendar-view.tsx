import type { DailyEntryCount } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { getJournalMonth, monthParts } from '../../utils/date'
import { Icon } from '../../components/icon'

type CalendarViewProps = {
  month: string
  counts: DailyEntryCount[]
  timezone: string
  onMonthChange: (month: string) => void
  onSelectDate: (date: string) => void
}

export function CalendarView({ month, counts, timezone, onMonthChange, onSelectDate }: CalendarViewProps) {
  const { year, month: monthNumber } = monthParts(month)
  const countByDate = new Map(counts.map((item) => [item.date, item.count]))
  const gridCells = createMonthCells(year, monthNumber)

  return (
    <section className="calendar-view" aria-label={zhTW.navigation.calendar}>
      <header className="calendar-view__header">
        <div>
          <h2>{zhTW.calendar.monthTitle(year, monthNumber)}</h2>
          <p>{zhTW.app.calendarDescription(counts.reduce((total, item) => total + item.count, 0))}</p>
        </div>
        <div className="calendar-view__controls">
          <button className="icon-button" type="button" aria-label={zhTW.actions.previousMonth} onClick={() => onMonthChange(previousMonth(month))}>
            <Icon>chevron_left</Icon>
          </button>
          <button className="button button--secondary" type="button" onClick={() => onMonthChange(getJournalMonth(timezone))}>
            {zhTW.actions.today}
          </button>
          <button className="icon-button" type="button" aria-label={zhTW.actions.nextMonth} onClick={() => onMonthChange(nextMonth(month))}>
            <Icon>chevron_right</Icon>
          </button>
        </div>
      </header>
      <div className="calendar-grid" role="grid" aria-label={zhTW.calendar.monthLabel(year, monthNumber)}>
        {zhTW.calendar.weekdays.map((weekday) => <div className="calendar-grid__weekday" role="columnheader" key={weekday}>{weekday}</div>)}
        {gridCells.map((cell, index) => {
          if (!cell) return <div className="calendar-grid__cell calendar-grid__cell--empty" role="gridcell" key={`empty-${index}`} />

          const count = countByDate.get(cell) ?? 0
          return (
            <div className="calendar-grid__cell" role="gridcell" key={cell}>
              <button
                type="button"
                className={`calendar-day${count ? ' calendar-day--has-entries' : ''}`}
                aria-label={zhTW.calendar.selectDate(cell, count)}
                disabled={count === 0}
                onClick={() => onSelectDate(cell)}
              >
                <span>{Number(cell.slice(-2))}</span>
                {count > 0 && <small>{zhTW.calendar.entryCount(count)}</small>}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function createMonthCells(year: number, month: number): Array<string | null> {
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function previousMonth(month: string): string {
  const { year, month: monthNumber } = monthParts(month)
  const date = new Date(Date.UTC(year, monthNumber - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string): string {
  const { year, month: monthNumber } = monthParts(month)
  const date = new Date(Date.UTC(year, monthNumber, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
