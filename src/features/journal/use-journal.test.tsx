import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ApiRequest } from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'
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
    const client = createClient({ restoreSession: async () => 'signed-out', run })
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
      await result.current.signOut()
      resolveBootstrap?.(bootstrap)
      await pendingBootstrap
    })

    expect(result.current.status).toBe('signed-out')
    expect(result.current.timezone).toBeUndefined()
    expect(client.signOut).toHaveBeenCalledOnce()
  })

  test('登出失敗時保留無資料安全畫面，並以集中訊息提供重試', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return categoryManagement
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const signOut = vi.fn()
      .mockRejectedValueOnce(new Error('logout service failure'))
      .mockResolvedValueOnce(undefined)
    const client = createClient({ run: run as JournalClient['run'], signOut })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      await result.current.signOut()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(zhTW.errors.signOut)
    expect(result.current.entries).toEqual([])
    expect(result.current.categories).toEqual([])

    await act(async () => {
      await result.current.retry()
    })
    expect(signOut).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('signed-out')
  })

  test('資料空間設定 session 不會 bootstrap，並清除既有記事資料', async () => {
    const run = vi.fn()
    const client = createClient({ restoreSession: async () => 'provisioning', run })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('provisioning'))

    expect(run).not.toHaveBeenCalled()
    expect(result.current.entries).toEqual([])
    expect(result.current.categories).toEqual([])
    expect(result.current.tagSuggestions).toEqual([])
    expect(result.current.filter.query).toBe('')
  })

  test('完成資料來源更換時先失效舊資料，再重新探測 session', async () => {
    const oldEntry = {
      id: 'entry-old', entryDate: '2026-08-20', title: '', content: '舊資料', categoryId: 'old', tags: [], links: [],
      createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
    }
    const oldCategory = {
      id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
    }
    const newEntry = {
      id: 'entry-new', entryDate: '2026-08-20', title: '', content: '新資料', categoryId: 'new', tags: [], links: [],
      createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
    }
    const newCategory = {
      id: 'new', name: '新分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
    }
    let usingReplacement = false
    type ReplacementBootstrap = {
      timezone: string
      categories: typeof newCategory[]
      tagSuggestions: string[]
    }
    let resolveReplacementBootstrap: ((value: ReplacementBootstrap) => void) | undefined
    const replacementBootstrap = new Promise<ReplacementBootstrap>((resolve) => {
      resolveReplacementBootstrap = resolve
    })
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') {
        return usingReplacement
          ? replacementBootstrap
          : { timezone: 'Asia/Taipei', categories: [oldCategory], tagSuggestions: ['舊標籤'] }
      }
      if (request.action === 'listCategories') {
        return usingReplacement
          ? { categories: [newCategory], entryCounts: { new: 1 } }
          : { categories: [oldCategory], entryCounts: { old: 1 } }
      }
      if (request.action === 'listEntries') {
        return { items: usingReplacement ? [newEntry] : [oldEntry], nextCursor: null }
      }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.entries).toEqual([oldEntry]))
    await act(async () => {
      await result.current.updateFilter({ query: '舊' })
    })

    act(() => {
      usingReplacement = true
      void result.current.replaceDataSource()
    })

    await waitFor(() => expect(result.current.status).toBe('loading'))
    expect(client.restoreSession).toHaveBeenCalledTimes(2)
    expect(result.current.entries).toEqual([])
    expect(result.current.categories).toEqual([])
    expect(result.current.tagSuggestions).toEqual([])
    expect(result.current.filter.query).toBe('')

    await act(async () => {
      resolveReplacementBootstrap?.({ timezone: 'Asia/Taipei', categories: [newCategory], tagSuggestions: ['新標籤'] })
      await replacementBootstrap
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await waitFor(() => expect(result.current.entries).toEqual([newEntry]))
    expect(result.current.tagSuggestions).toEqual(['新標籤'])
  })

  test('類別搬移分頁遇到 401 時清除主工作區並切回未登入', async () => {
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return bootstrap
      if (request.action === 'listCategories') return categoryManagement
      if (request.action === 'listEntries') {
        if (request.filter.categoryId === 'work') throw new AuthenticationError()
        return { items: [], nextCursor: null }
      }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      await expect(result.current.loadCategoryEntryPage('work', null)).rejects.toBeInstanceOf(AuthenticationError)
    })

    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(result.current.categories).toEqual([])
    expect(result.current.entries).toEqual([])
  })

  test('資料來源更換期間拒絕舊類別搬移分頁回應', async () => {
    const newCategory = {
      id: 'new',
      name: '新分類',
      isActive: true,
      createdAt: '2026-08-20T00:00:00+08:00',
      updatedAt: '2026-08-20T00:00:00+08:00',
    }
    const newEntry = {
      id: 'entry-new', entryDate: '2026-08-20', title: '', content: '新資料', categoryId: 'new', tags: [], links: [],
      createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
    }
    let useReplacement = false
    let resolvePage: ((value: { items: typeof newEntry[]; nextCursor: null }) => void) | undefined
    const pendingPage = new Promise<{ items: typeof newEntry[]; nextCursor: null }>((resolve) => {
      resolvePage = resolve
    })
    const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') {
        return useReplacement
          ? { timezone: 'Asia/Taipei', categories: [newCategory], tagSuggestions: ['新標籤'] }
          : bootstrap
      }
      if (request.action === 'listCategories') {
        return useReplacement
          ? { categories: [newCategory], entryCounts: { new: 1 } }
          : categoryManagement
      }
      if (request.action === 'listEntries') {
        if (request.filter.categoryId === 'work') return pendingPage
        return { items: useReplacement ? [newEntry] : [], nextCursor: null }
      }
      throw new Error(`未預期的請求：${request.action}`)
    })
    const client = createClient({ run: run as JournalClient['run'] })
    const { result } = renderHook(() => useJournal(client))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    let pageRequest: Promise<unknown> = Promise.resolve()
    act(() => {
      pageRequest = result.current.loadCategoryEntryPage('work', null)
    })
    const rejected = expect(pageRequest).rejects.toBeInstanceOf(Error)

    act(() => {
      useReplacement = true
      void result.current.replaceDataSource()
    })
    await waitFor(() => expect(result.current.entries).toEqual([newEntry]))

    await act(async () => {
      resolvePage?.({ items: [newEntry], nextCursor: null })
      await pendingPage
    })
    await rejected
    expect(result.current.categories).toEqual([newCategory])
    expect(result.current.entries).toEqual([newEntry])
  })
})

function createClient(overrides: Partial<JournalClient> = {}): JournalClient {
  return {
    restoreSession: vi.fn(async () => 'authenticated' as const),
    beginSignIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
    run: vi.fn(),
    ...overrides,
  }
}
