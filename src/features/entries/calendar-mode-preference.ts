import type { CalendarMode } from './calendar-date'

const CALENDAR_MODE_STORAGE_KEY = 'daily-journal:calendar-mode'

export function readCalendarModePreference(): CalendarMode {
  try {
    const value = window.localStorage.getItem(CALENDAR_MODE_STORAGE_KEY)
    return value === 'day' || value === 'week' || value === 'month' ? value : 'month'
  } catch {
    return 'month'
  }
}

export function saveCalendarModePreference(mode: CalendarMode): void {
  try {
    window.localStorage.setItem(CALENDAR_MODE_STORAGE_KEY, mode)
  } catch {
    // 模式仍在目前 React state 生效；無法持久化不應阻止操作。
  }
}