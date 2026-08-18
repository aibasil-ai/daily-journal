import { executeAppRequest as dispatchAppRequest } from './api/dispatcher'
import type { ApiRequest, ApiResponse } from './domain/journal'
import { initializeJournal as setupJournal } from './setup'

/** GAS Execution API 唯一公開的資料操作入口。 */
export function executeAppRequest(request: ApiRequest): ApiResponse<unknown> {
  return dispatchAppRequest(request)
}

/** 僅供 Apps Script 編輯器初始化資料表使用。 */
export function initializeJournal(spreadsheetId?: string): void {
  setupJournal(spreadsheetId)
}
