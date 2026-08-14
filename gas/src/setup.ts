import { JournalError, isJournalError } from './domain/errors'
import { AppsScriptJournalStore } from './repositories/apps-script-journal-store'
import { JournalService } from './services/journal-service'

/**
 * 僅供 Apps Script 編輯器手動執行。
 * Google Sheets ID 只會寫入 Script Properties，不會傳給前端。
 */
export function initializeJournal(spreadsheetId?: string): void {
  try {
    const store = new AppsScriptJournalStore()
    if (spreadsheetId === undefined) {
      // 可直接在 Apps Script 編輯器執行；試算表 ID 預先存於 Script Properties。
      store.ensureSchema()
      return
    }

    const normalizedId = spreadsheetId.trim()
    if (!normalizedId) {
      throw new JournalError('VALIDATION_ERROR', '請提供 Google Sheets ID。')
    }
    store.initializeSpreadsheet(normalizedId)
  } catch (error) {
    if (isJournalError(error)) throw error
    throw new JournalError(
      'CONFIGURATION_ERROR',
      '無法儲存 Google Sheets ID 或初始化資料表。請確認 Apps Script 授權、試算表存取權限與工作表保護設定後再試。',
    )
  }
}

/** 建立正式環境服務，時間與 UUID 一律由 Apps Script 及試算表時區提供。 */
export function createJournalService(): JournalService {
  const store = new AppsScriptJournalStore()
  return new JournalService(store, () => store.createTimestamp(), () => store.createUuid())
}
