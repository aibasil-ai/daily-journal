import { CATEGORY_HEADERS, ENTRY_HEADERS, SETTINGS_HEADERS, AppsScriptJournalStore } from './repositories/apps-script-journal-store'

export { CATEGORY_HEADERS, ENTRY_HEADERS, SETTINGS_HEADERS }

export function initializeJournal(): void {
  new AppsScriptJournalStore().ensureSchema()
}
