export type JournalView = 'timeline' | 'calendar'

const viewPreferenceKey = 'daily-journal:view'

export function getInitialView(width: number, stored: JournalView | null): JournalView {
  return stored ?? (width < 768 ? 'timeline' : 'calendar')
}

export function loadViewPreference(): JournalView | null {
  if (typeof window === 'undefined') return null

  const stored = window.localStorage.getItem(viewPreferenceKey)
  return stored === 'timeline' || stored === 'calendar' ? stored : null
}

export function saveViewPreference(view: JournalView) {
  window.localStorage.setItem(viewPreferenceKey, view)
}
