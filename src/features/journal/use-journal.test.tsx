import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ApiRequest } from '../../domain/journal'
import { AuthenticationError } from '../../services/journal-api-client'
import { type JournalClient, useJournal } from './use-journal'

const bootstrap = {
  timezone: 'Asia/Taipei',
  categories: [],
  tagSuggestions: [],
}

describe('useJournal', () => {
  test('有效 session 會自動 bootstrap 並載入首頁記事', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return []
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))
    expect(run).toHaveBeenCalledWith({ action: 'bootstrap' })
  })

  test('未登入時不會 bootstrap', async () => {
    const run = vi.fn()
    const client = createClient({ restoreSession: async () => false, run })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(run).not.toHaveBeenCalled()
  })

  test('bootstrap 遇到 401 時清除資料並切回未登入', async () => {
    const run = vi.fn(async () => {
      throw new AuthenticationError()
    })
    const client = createClient({ run })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(result.current.entries).toEqual([])
    expect(result.current.categories).toEqual([])
  })

  test('登出後忽略尚未完成的 bootstrap 回應', async () => {
    let resolveBootstrap: ((value: typeof bootstrap) => void) | undefined
    const pendingBootstrap = new Promise<typeof bootstrap>((resolve) => {
      resolveBootstrap = resolve
    })
    const client = createClient({
      run: vi.fn(async (request: ApiRequest) => {
        if (request.action === 'bootstrap') return pendingBootstrap
        throw new Error(`未預期的請求：${request.action}`)
      }) as JournalClient['run'],
    })
    const { result } = renderHook(() => useJournal(client))

    await act(async () => {
      result.current.signOut()
      resolveBootstrap?.(bootstrap)
      await pendingBootstrap
    })

    expect(result.current.status).toBe('signed-out')
    expect(result.current.timezone).toBeUndefined()
    expect(client.signOut).toHaveBeenCalledOnce()
  })
})

function createClient(overrides: Partial<JournalClient> = {}): JournalClient {
  return {
    restoreSession: async () => true,
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(),
    ...overrides,
  }
}
