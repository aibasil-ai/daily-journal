import { initializeJournal } from './setup'
import { executeAppRequest } from './api/dispatcher'

export { initializeJournal }

const gasGlobal = globalThis as typeof globalThis & {
  initializeJournal?: typeof initializeJournal
  executeAppRequest?: typeof executeAppRequest
}

// GAS 編輯器需要全域函式；初始化無參數且只會冪等建立既有試算表的 schema。
gasGlobal.initializeJournal = initializeJournal
gasGlobal.executeAppRequest = executeAppRequest
