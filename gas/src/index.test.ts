// @vitest-environment node

import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  delete (globalThis as { executeAppRequest?: unknown }).executeAppRequest
  delete (globalThis as { initializeJournal?: unknown }).initializeJournal
  vi.resetModules()
})

test('僅將 executeAppRequest 掛到 GAS 全域範圍', async () => {
  await import('./index')

  expect(globalThis.executeAppRequest).toEqual(expect.any(Function))
  expect(globalThis.initializeJournal).toBeUndefined()
})
