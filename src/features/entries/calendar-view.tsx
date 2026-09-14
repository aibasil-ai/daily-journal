import type { Category, DailyEntries, Entry } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
import { getJournalDate, getJournalMonth, monthParts } from '../../utils/date'
import { Icon } from '../../components/icon'
import { CalendarMonthView } from './calendar-month-view'

type CalendarViewProps = {
  month: string
  days: DailyEntries[]
  categories: Category[]
  timezone: string
  onMonthChange: (month: string) => void
  onSelectDate: (date: string) => void
  onOpenEntry: (entry: Entry) => void
}

export function CalendarView({ month, days, categories, timezone, onMonthChange, onSelectDate, onOpenEntry }: CalendarViewProps) {
  const { year, month: monthNumber } = monthParts(month)

  return (
    <section className="calendar-view" aria-label={zhTW.navigation.calendar}>
      <header className="calendar-view__header">
        <div>
          <h2>{zhTW.calendar.monthTitle(year, monthNumber)}</h2>
          <p>{zhTW.app.calendarDescription(days.reduce((total, day) => total + day.entries.length, 0))}</p>
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
      <CalendarMonthView
        anchorDate={`${month}-01`}
        today={getJournalDate(timezone)}
        days={days}
        categories={categories}
        onFocusDate={() => undefined}
        onSelectDate={onSelectDate}
        onOpenEntry={onOpenEntry}
      />
    </section>
  )
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
