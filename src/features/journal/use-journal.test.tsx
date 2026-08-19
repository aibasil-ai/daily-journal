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

const categoryManagement = {
  categories: [{
    id: 'work',
    name: '工作',
    isActive: true,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }],
  entryCounts: { work: 2 },
}

describe('useJournal', () => {
  test('有效 session 會自動 bootstrap 並載入首頁記事', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return categoryManagement
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))
    expect(run).toHaveBeenCalledWith({ action: 'bootstrap' })
    expect(result.current.categoryEntryCounts).toEqual({ work: 2 })
  })

  test('進入 provisioning 狀態時會載入候選試算表', async () => {
    const getCandidates = vi.fn(async () => [{ id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19' }])
    const client = createClient({
      restoreSession: async () => ({ state: 'provisioning', user: { name: 'New User' } }),
      getCandidates,
    })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('provisioning'))
    await waitFor(() => expect(result.current.candidates).toEqual([{ id: 'sheet-1', name: '我的日記', modifiedTime: '2026-08-19' }]))
    expect(result.current.user?.name).toBe('New User')
  })

  test('搬移成功後刷新類別摘要與目前主記事清單', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return categoryManagement
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'moveEntries') return { movedCount: 2 }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    run.mockClear()
    await act(async () => {
      await result.current.moveEntries('work', 'life', ['one', 'two'])
    })

    expect(run).toHaveBeenCalledWith({
      action: 'moveEntries',
      sourceCategoryId: 'work',
      targetCategoryId: 'life',
      entryIds: ['one', 'two'],
    })
    expect(run).toHaveBeenCalledWith({ action: 'listCategories' })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' }))
  })

  test('搬移失敗時會將錯誤拋回呼叫端，並保留已知摘要', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return categoryManagement
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'moveEntries') throw new Error('搬移失敗')
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      await expect(result.current.moveEntries('work', 'life', ['one'])).rejects.toThrow('搬移失敗')
    })

    expect(result.current.categoryEntryCounts).toEqual({ work: 2 })
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

