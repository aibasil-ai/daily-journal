// @vitest-environment node

import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  delete (globalThis as { __dailyJournalExecuteAppRequest?: unknown }).__dailyJournalExecuteAppRequest
  delete (globalThis as { __dailyJournalInitializeJournal?: unknown }).__dailyJournalInitializeJournal
  vi.resetModules()
})

test('將 GAS wrapper 的內部實作掛到安全命名的全域範圍', async () => {
  await import('./index')

  expect(globalThis.__dailyJournalExecuteAppRequest).toEqual(expect.any(Function))
  expect(globalThis.__dailyJournalInitializeJournal).toEqual(expect.any(Function))
  expect(globalThis.__dailyJournalInitializeJournal).toHaveLength(0)
  expect(globalThis.initializeJournal).toBeUndefined()
  expect(globalThis.executeAppRequest).toBeUndefined()
})
