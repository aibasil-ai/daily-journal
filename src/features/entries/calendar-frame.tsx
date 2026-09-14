import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import { formatCalendarPeriodTitle, type CalendarMode } from './calendar-date'

const MODES: CalendarMode[] = ['day', 'week', 'month']

const navigationLabels = {
  day: [zhTW.actions.previousDay, zhTW.actions.nextDay],
  week: [zhTW.actions.previousWeek, zhTW.actions.nextWeek],
  month: [zhTW.actions.previousMonth, zhTW.actions.nextMonth],
} as const

type CalendarFrameProps = {
  mode: CalendarMode
  anchorDate: string
  entryCount: number | null
  isLoading: boolean
  error?: string
  canMovePrevious: boolean
  canMoveNext: boolean
  onModeChange: (mode: CalendarMode) => void
  onMovePeriod: (direction: -1 | 1) => void
  onToday: () => void
  onRetry: () => void
  children: ReactNode
}

export function CalendarFrame({
  mode,
  anchorDate,
  entryCount,
  isLoading,
  error,
  canMovePrevious,
  canMoveNext,
  onModeChange,
  onMovePeriod,
  onToday,
  onRetry,
  children,
}: CalendarFrameProps) {
  const [previousLabel, nextLabel] = navigationLabels[mode]

  return (
    <section className="calendar-frame" aria-label={zhTW.navigation.calendar}>
      <header className="calendar-frame__header">
        <div className="calendar-frame__period" aria-live="polite" aria-atomic="true">
          <h2>{formatCalendarPeriodTitle(mode, anchorDate)}</h2>
          {entryCount !== null && <p>{zhTW.calendar.periodEntryCount[mode](entryCount)}</p>}
        </div>
        <div
          className="calendar-frame__mode-toggle"
          role="group"
          aria-label={zhTW.accessibility.calendarViewMode}
        >
          {MODES.map((candidate) => (
            <button
              type="button"
              aria-pressed={candidate === mode}
              onClick={() => onModeChange(candidate)}
              key={candidate}
            >
              {zhTW.calendar.modes[candidate]}
            </button>
          ))}
        </div>
        <div className="calendar-frame__navigation">
          <button className="icon-button" type="button" aria-label={previousLabel} disabled={!canMovePrevious} onClick={() => onMovePeriod(-1)}>
            <Icon>chevron_left</Icon>
          </button>
          <button className="button button--secondary" type="button" onClick={onToday}>
            {zhTW.actions.today}
          </button>
          <button className="icon-button" type="button" aria-label={nextLabel} disabled={!canMoveNext} onClick={() => onMovePeriod(1)}>
            <Icon>chevron_right</Icon>
          </button>
        </div>
      </header>
      <div
        className="calendar-frame__content"
        role="region"
        aria-label={zhTW.accessibility.calendarContent}
        aria-busy={isLoading}
      >
        {error ? (
          <div className="calendar-frame__error" role="alert">
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={onRetry}>
              {zhTW.actions.reload}
            </button>
          </div>
        ) : children}
      </div>
    </section>
  )
}