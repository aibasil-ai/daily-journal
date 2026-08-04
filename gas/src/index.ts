import { initializeJournal } from './setup'
import { executeAppRequest } from './api/dispatcher'

export { initializeJournal }

;(globalThis as typeof globalThis & { executeAppRequest?: typeof executeAppRequest }).executeAppRequest = executeAppRequest
