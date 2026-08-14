export type JournalView = 'timeline' | 'calendar'

const VIEW_STORAGE_KEY = 'daily-journal:view'

export function getInitialView(width: number, stored: JournalView | null): JournalView {
  return stored ?? (width < 768 ? 'timeline' : 'calendar')
}

export function readViewPreference(): JournalView | null {
  const value = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return value === 'timeline' || value === 'calendar' ? value : null
}

export function saveViewPreference(view: JournalView): void {
  window.localStorage.setItem(VIEW_STORAGE_KEY, view)
}
