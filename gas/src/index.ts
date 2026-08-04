import { initializeJournal } from './setup'

export { initializeJournal }

;(globalThis as typeof globalThis & { initializeJournal?: typeof initializeJournal }).initializeJournal = initializeJournal
