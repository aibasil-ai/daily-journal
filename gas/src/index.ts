import { initializeJournal } from './setup'
import { executeAppRequest } from './api/dispatcher'

export { initializeJournal, executeAppRequest }

const gasGlobal = globalThis as typeof globalThis & {
  __dailyJournalInitializeJournal?: typeof initializeJournal
  __dailyJournalExecuteAppRequest?: typeof executeAppRequest
}

// 建置腳本會以頂層 GAS wrapper 呼叫這些安全命名的內部實作。
gasGlobal.__dailyJournalInitializeJournal = initializeJournal
gasGlobal.__dailyJournalExecuteAppRequest = executeAppRequest
