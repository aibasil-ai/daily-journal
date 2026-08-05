import type { ApiRequest, ApiResponse } from '../domain/journal'
import { JournalSetupError } from '../domain/errors'
import { AppsScriptJournalStore } from '../repositories/apps-script-journal-store'
import { createJournalService, JournalService, JournalServiceError } from '../services/journal-service'

declare const console: {
  error(...data: unknown[]): void
}

const apiMessages = {
  invalidAction: '不支援的操作。',
  internalError: '處理資料時發生錯誤，請稍後再試。',
} as const

export function executeAppRequest(
  request: ApiRequest,
  service: Pick<JournalService, 'bootstrap' | 'listEntries' | 'getEntriesForDate' | 'getMonthlyEntryCounts' | 'saveEntry' | 'deleteEntry' | 'saveCategory' | 'deactivateCategory' | 'exportEntries'> = createJournalService(new AppsScriptJournalStore()),
): ApiResponse<unknown> {
  try {
    switch (request.action) {
      case 'bootstrap': return { ok: true, data: service.bootstrap() }
      case 'listEntries': return { ok: true, data: service.listEntries(request.filter) }
      case 'getEntriesForDate': return { ok: true, data: service.getEntriesForDate(request.date, request.filter) }
      case 'getMonthlyEntryCounts': return { ok: true, data: service.getMonthlyEntryCounts(request.year, request.month, request.filter) }
      case 'saveEntry': return { ok: true, data: service.saveEntry(request.entry) }
      case 'deleteEntry': service.deleteEntry(request.id); return { ok: true, data: null }
      case 'saveCategory': return { ok: true, data: service.saveCategory(request.category) }
      case 'deactivateCategory': return { ok: true, data: service.deactivateCategory(request.id) }
      case 'exportEntries': return { ok: true, data: service.exportEntries(request.filter) }
      default: return { ok: false, code: 'INVALID_ACTION', message: apiMessages.invalidAction }
    }
  } catch (error) {
    if (error instanceof JournalServiceError || error instanceof JournalSetupError) {
      return { ok: false, code: 'REQUEST_ERROR', message: error.message }
    }

    console.error('executeAppRequest 失敗：', error)
    return { ok: false, code: 'INTERNAL_ERROR', message: apiMessages.internalError }
  }
}
