import { initializeJournal } from './setup'
import { executeAppRequest } from './api/dispatcher'

export { initializeJournal }

const gasGlobal = globalThis as typeof globalThis & {
  initializeJournal?: typeof initializeJournal
  executeAppRequest?: typeof executeAppRequest
}

// 僅供部署者在 GAS 編輯器手動初始化；前端只能呼叫 executeAppRequest。
gasGlobal.initializeJournal = initializeJournal
gasGlobal.executeAppRequest = executeAppRequest
