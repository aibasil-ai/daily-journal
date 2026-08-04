import { CATEGORY_HEADERS, ENTRY_HEADERS, SETTINGS_HEADERS, AppsScriptJournalStore } from './repositories/apps-script-journal-store'

export { CATEGORY_HEADERS, ENTRY_HEADERS, SETTINGS_HEADERS }

export function initializeJournal(spreadsheetId: string): void {
  const normalizedSpreadsheetId = spreadsheetId.trim()
  if (!normalizedSpreadsheetId) throw new Error('請提供 Google Sheets ID。')

  new AppsScriptJournalStore().initialize(normalizedSpreadsheetId)
}
