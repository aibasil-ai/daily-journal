export type JournalView = 'timeline' | 'calendar'

const VIEW_STORAGE_KEY = 'daily-journal:view'

export function getInitialView(width: number, stored: JournalView | null): JournalView {
  return stored ?? (width < 768 ? 'timeline' : 'calendar')
}

export function readViewPreference(): JournalView | null {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return value === 'timeline' || value === 'calendar' ? value : null
  } catch {
    return null
  }
}

export function saveViewPreference(view: JournalView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // 目前導覽仍應繼續，只有跨重新整理偏好無法保存。
  }
}
