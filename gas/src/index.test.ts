// @vitest-environment node

import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  delete (globalThis as { executeAppRequest?: unknown }).executeAppRequest
  delete (globalThis as { initializeJournal?: unknown }).initializeJournal
  vi.resetModules()
})

test('將部署初始化與前端 API 函式掛到 GAS 全域範圍', async () => {
  await import('./index')

  expect(globalThis.executeAppRequest).toEqual(expect.any(Function))
  expect(globalThis.initializeJournal).toEqual(expect.any(Function))
  expect(globalThis.initializeJournal).toHaveLength(0)
})
