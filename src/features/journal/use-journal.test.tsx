// @vitest-environment jsdom

import '../../test/dialog-setup'
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from '../../App'
import type { ApiRequest, Entry, EntryListResult } from '../../domain/journal'
import { AuthenticationError, JournalApiClientError } from '../../services/journal-api-client'
import { SessionEndedError, type JournalClient, useJournal } from './use-journal'

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('已登入工作階段在掛載後自動 bootstrap 並載入記事', async () => {
  const client = journalClient(async (request) => (
    request.action === 'bootstrap'
      ? bootstrap()
      : entryPage([entry('restored', '2026-08-05')])
  ))

  render(<App client={client} />)

  expect(await screen.findByText('記事內容 restored')).toBeInTheDocument()
  expect(client.restoreSession).toHaveBeenCalledOnce()
  expect(client.run).toHaveBeenCalledWith({ action: 'bootstrap' })
})

test('沒有工作階段時顯示登入按鈕且不 bootstrap', async () => {
  const client = journalClient(vi.fn(), false)

  render(<App client={client} />)

  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(client.run).not.toHaveBeenCalled()
})

test('bootstrap 的 401 清除畫面並切回未登入狀態', async () => {
  const client = journalClient(vi.fn().mockRejectedValue(new AuthenticationError()))

  render(<App client={client} />)

  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(client.signOut).toHaveBeenCalledOnce()
})

test('登入按鈕只啟動伺服器 OAuth 導向', async () => {
  const client = journalClient(vi.fn(), false)
  const user = userEvent.setup()

  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(client.beginSignIn).toHaveBeenCalledOnce()
  expect(client.run).not.toHaveBeenCalled()
})

test('工作階段檢查失敗時顯示可重新嘗試的錯誤，重試後載入資料', async () => {
  const client = journalClient(async (request) => (
    request.action === 'bootstrap' ? bootstrap() : entryPage()
  ))
  client.restoreSession
    .mockRejectedValueOnce(new JournalApiClientError())
    .mockResolvedValueOnce(true)
  const user = userEvent.setup()

  render(<App client={client} />)

  expect(await screen.findByText('暫時無法連線至服務，請稍後再試。')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重新嘗試' }))

  expect(await screen.findByText('已登入。')).toBeInTheDocument()
  expect(client.restoreSession).toHaveBeenCalledTimes(2)
})

test('登出立即清除畫面，且忽略尚未完成的列表回應', async () => {
  const pendingList = deferred<EntryListResult>()
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return pendingList.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<JournalTestHarness client={client} />)
  await screen.findByText('狀態：ready')
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingList.resolve(entryPage([entry('stale', '2026-08-05')])))

  expect(client.signOut).toHaveBeenCalledOnce()
  expect(screen.getByText('狀態：signed-out')).toBeInTheDocument()
  expect(screen.queryByText('記事內容 stale')).not.toBeInTheDocument()
})

test('記事請求的 401 清除既有資料並結束工作階段', async () => {
  const client = journalClient(vi.fn()
    .mockResolvedValueOnce(bootstrap())
    .mockRejectedValueOnce(new AuthenticationError()))

  render(<JournalTestHarness client={client} />)

  expect(await screen.findByText('狀態：signed-out')).toBeInTheDocument()
  expect(client.signOut).toHaveBeenCalledOnce()
})

test('匯出請求的 401 清除畫面且不保留匯出錯誤', async () => {
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage([entry('loaded', '2026-08-05')])
    if (request.action === 'exportEntries') throw new AuthenticationError()
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await screen.findByText('記事內容 loaded')
  await user.click(screen.getByRole('button', { name: '匯出資料' }))
  const exportDialog = await screen.findByRole('dialog', { name: 'CSV 匯出' })
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))

  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(client.signOut).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('自動恢復後可載入更多、儲存並刪除時間軸記事', async () => {
  const first = entry('first', '2026-08-04')
  const second = entry('second', '2026-08-03')
  let saved: Entry | undefined
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return request.filter.cursor === 'page-2' ? entryPage([second]) : entryPage(saved ? [saved, first] : [first], saved ? null : 'page-2')
    if (request.action === 'saveEntry') return saved = entry('saved', request.entry.entryDate, { ...request.entry, id: 'saved' })
    if (request.action === 'deleteEntry') return undefined
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await screen.findByText('記事內容 first')
  await user.click(screen.getByRole('button', { name: '載入更多' }))
  expect(await screen.findByText('記事內容 second')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '新增記事' }))
  const editorDialog = await screen.findByRole('dialog', { name: '新增記事' })
  await user.type(within(editorDialog).getByLabelText('記事內容'), '新記事')
  await user.selectOptions(within(editorDialog).getByLabelText('分類'), 'work')
  await user.click(within(editorDialog).getByRole('button', { name: '儲存記事' }))
  const savedCard = (await screen.findByRole('heading', { name: '新記事' })).closest('article')!
  await user.click(within(savedCard).getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '新記事' })).not.toBeInTheDocument())
})

test('篩選只採用最新請求，並忽略儲存後過期的列表回應', async () => {
  const requests = new Map<string, (value: EntryListResult) => void>()
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return new Promise<EntryListResult>((resolve) => requests.set(request.filter.query, resolve))
    if (request.action === 'saveEntry') return entry('saved', request.entry.entryDate, request.entry)
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  const search = await screen.findByRole('searchbox', { name: '關鍵字' })
  await user.type(search, '週會')
  await act(async () => requests.get('週會')?.(entryPage([entry('new', '2026-08-04')])))
  expect(await screen.findByText('記事內容 new')).toBeInTheDocument()
  await act(async () => requests.get('週')?.(entryPage([entry('old', '2026-08-03')])))
  expect(screen.queryByText('記事內容 old')).not.toBeInTheDocument()
})

test('月曆切換取得計數，選日依目前篩選載入記事', async () => {
  let selectedDate = ''
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'getMonthlyEntryCounts') {
      selectedDate = `${request.year}-${String(request.month).padStart(2, '0')}-04`
      return [{ date: selectedDate, count: 2 }]
    }
    if (request.action === 'getEntriesForDate') return [entry('selected', request.date)]
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')

  render(<App client={client} />)
  await waitFor(() => expect(selectedDate).not.toBe(''))
  await user.click(await screen.findByRole('button', { name: `${selectedDate}，共 2 則記事` }))
  expect(await screen.findByText('記事內容 selected')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下個月' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getMonthlyEntryCounts' })))
})

test('取得日期記事時回傳 API 的完整資料', async () => {
  const entries = [entry('morning', '2026-08-04'), entry('evening', '2026-08-04')]
  const client = journalClient(async (request) => request.action === 'bootstrap' ? bootstrap() : entries)
  const user = userEvent.setup()

  render(<DateSelectionHarness client={client} />)
  await user.click(await screen.findByRole('button', { name: '載入 2026-08-04' }))

  expect(await screen.findByText('morning,evening')).toBeInTheDocument()
})

test('CSV 匯出成功下載資料，失敗時顯示後端訊息', async () => {
  const createObjectURL = vi.fn(() => 'blob:csv')
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  let fail = false
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') {
      if (fail) throw new Error('匯出資料失敗')
      return { headers: ['標題'], rows: [['記事']] }
    }
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await screen.findByText('已登入。')
  await user.click(screen.getByRole('button', { name: '匯出資料' }))
  const exportDialog = await screen.findByRole('dialog', { name: 'CSV 匯出' })
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))
  expect(createObjectURL).toHaveBeenCalledOnce()
  fail = true
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('匯出資料失敗')
})

test('登出後以 SessionEndedError 隔離未完成的匯出回應', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const onExportError = vi.fn()
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return pendingExport.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<JournalTestHarness client={client} onExportError={onExportError} />)
  await screen.findByText('狀態：ready')
  await user.click(screen.getByRole('button', { name: '匯出' }))
  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.resolve({ headers: ['標題'], rows: [['過期記事']] }))
  await waitFor(() => expect(onExportError).toHaveBeenCalledWith(expect.any(SessionEndedError)))
})

test('正式 App 登出後不下載過期匯出或顯示過期失敗', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const createObjectURL = vi.fn(() => 'blob:csv')
  const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadClick.mockClear()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return pendingExport.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: '匯出資料' }))
  const exportDialog = await screen.findByRole('dialog', { name: 'CSV 匯出' })
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))
  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.resolve({ headers: ['標題'], rows: [['過期記事']] }))
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(downloadClick).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('正式 App 登出後不顯示過期匯出失敗', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return pendingExport.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: '匯出資料' }))
  const exportDialog = await screen.findByRole('dialog', { name: 'CSV 匯出' })
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))
  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.reject(new Error('過期匯出失敗')))

  expect(screen.getByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('儲存後重新載入列表時不讓 pre-save 回應覆寫新資料', async () => {
  const preSaveList = deferred<EntryListResult>()
  const refreshedList = deferred<EntryListResult>()
  let listCallCount = 0
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return listCallCount++ === 0 ? preSaveList.promise : refreshedList.promise
    if (request.action === 'saveEntry') return entry('saved', request.entry.entryDate, { ...request.entry, id: 'saved' })
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={client} />)
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))
  await user.click(screen.getByRole('button', { name: '新增記事' }))
  const editorDialog = await screen.findByRole('dialog', { name: '新增記事' })
  await user.type(within(editorDialog).getByLabelText('記事內容'), '新記事')
  await user.selectOptions(within(editorDialog).getByLabelText('分類'), 'work')
  await user.click(within(editorDialog).getByRole('button', { name: '儲存記事' }))
  await act(async () => {
    preSaveList.resolve(entryPage([entry('old-list', '2026-08-03')]))
    refreshedList.resolve(entryPage([entry('saved', '2026-08-04', { title: '', content: '新記事' })]))
  })

  expect(await screen.findByRole('heading', { name: '新記事' })).toBeInTheDocument()
  expect(screen.queryByText('記事內容 old-list')).not.toBeInTheDocument()
})

test('新增、改期與刪除後更新月曆計數，且忽略舊計數回應', async () => {
  const staleCounts = deferred<{ date: string; count: number }[]>()
  let requestedMonth = ''
  let monthlyRequestCount = 0
  let saved: Entry | undefined
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return entryPage(saved ? [saved] : [])
    if (request.action === 'getMonthlyEntryCounts') {
      requestedMonth = `${request.year}-${String(request.month).padStart(2, '0')}`
      monthlyRequestCount += 1
      if (monthlyRequestCount === 1) return staleCounts.promise
      if (monthlyRequestCount === 2) return [{ date: `${requestedMonth}-10`, count: 1 }]
      if (monthlyRequestCount === 3) return [{ date: `${requestedMonth}-11`, count: 1 }]
      return []
    }
    if (request.action === 'saveEntry') return saved = entry('saved', request.entry.entryDate, { ...request.entry, id: 'saved' })
    if (request.action === 'deleteEntry') {
      saved = undefined
      return undefined
    }
    if (request.action === 'getEntriesForDate') return saved ? [saved] : []
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')

  render(<App client={client} />)
  await waitFor(() => expect(monthlyRequestCount).toBe(1))
  const originalDate = `${requestedMonth}-10`
  const movedDate = `${requestedMonth}-11`
  await user.click(screen.getByRole('button', { name: '新增記事' }))
  const newEditorDialog = await screen.findByRole('dialog', { name: '新增記事' })
  fireEvent.change(within(newEditorDialog).getByLabelText('記錄日期'), { target: { value: originalDate } })
  await user.type(within(newEditorDialog).getByLabelText('記事內容'), '待同步記事')
  await user.selectOptions(within(newEditorDialog).getByLabelText('分類'), 'work')
  await user.click(within(newEditorDialog).getByRole('button', { name: '儲存記事' }))
  await waitFor(() => expect(monthlyRequestCount).toBe(2))
  await user.click(await screen.findByRole('button', { name: `${originalDate}，共 1 則記事` }))
  const readerDialog = await screen.findByRole('dialog', { name: '閱讀記事' })
  await user.click(within(readerDialog).getByRole('button', { name: '編輯記事' }))
  const editEditorDialog = await screen.findByRole('dialog', { name: '編輯記事' })
  fireEvent.change(within(editEditorDialog).getByLabelText('記錄日期'), { target: { value: movedDate } })
  await user.type(within(editEditorDialog).getByLabelText('記事內容'), '待同步記事')
  await user.selectOptions(within(editEditorDialog).getByLabelText('分類'), 'work')
  await user.click(within(editEditorDialog).getByRole('button', { name: '儲存記事' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'saveEntry', entry: expect.objectContaining({ entryDate: movedDate }) })))
  await waitFor(() => expect(monthlyRequestCount).toBe(3))
  await user.click(await screen.findByRole('button', { name: `${movedDate}，共 1 則記事` }))
  const movedReaderDialog = await screen.findByRole('dialog', { name: '閱讀記事' })
  await user.click(within(movedReaderDialog).getByRole('button', { name: '刪除記事' }))
  const deleteDialog = await screen.findByRole('dialog', { name: '刪除記事確認' })
  await user.click(within(deleteDialog).getByRole('button', { name: '確認刪除' }))
  await waitFor(() => expect(monthlyRequestCount).toBe(4))
  await act(async () => staleCounts.resolve([{ date: originalDate, count: 99 }]))

  expect(screen.getByRole('button', { name: `${originalDate}，共 0 則記事` })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: `${movedDate}，共 0 則記事` })).toBeInTheDocument()
})

test('選日期結果不讓較舊 listEntries 回應覆寫', async () => {
  const listResponse = deferred<EntryListResult>()
  const selectedResponse = deferred<Entry[]>()
  let selectedDate = ''
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return bootstrap()
    if (request.action === 'listEntries') return listResponse.promise
    if (request.action === 'getMonthlyEntryCounts') {
      selectedDate = `${request.year}-${String(request.month).padStart(2, '0')}-04`
      return [{ date: selectedDate, count: 1 }]
    }
    if (request.action === 'getEntriesForDate') return selectedResponse.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')

  render(<App client={client} />)
  await waitFor(() => expect(selectedDate).not.toBe(''))
  await user.click(screen.getByRole('button', { name: `${selectedDate}，共 1 則記事` }))
  await act(async () => selectedResponse.resolve([entry('selected-date', selectedDate)]))
  expect(await screen.findByText('記事內容 selected-date')).toBeInTheDocument()
  await act(async () => listResponse.resolve(entryPage([entry('old-list', selectedDate)])))

  expect(screen.getByText('記事內容 selected-date')).toBeInTheDocument()
  expect(screen.queryByText('記事內容 old-list')).not.toBeInTheDocument()
})

test('匯出目前篩選與全部記事分別送出目前及 default filter', async () => {
  const client = journalClient(async (request) => {
    if (request.action === 'bootstrap') return { ...bootstrap(), tagSuggestions: ['會議'] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return { headers: ['標題'], rows: [['記事']] }
    throw new Error('未預期的請求')
  })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const user = userEvent.setup()

  render(<App client={client} />)
  await user.type(await screen.findByRole('searchbox', { name: '關鍵字' }), '週會')
  fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-08-01' } })
  fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-08-31' } })
  await user.selectOptions(screen.getByLabelText('分類篩選'), 'work')
  await user.selectOptions(screen.getByLabelText('標籤篩選'), '會議')
  await user.click(screen.getByRole('button', { name: '匯出資料' }))
  const exportDialog = await screen.findByRole('dialog', { name: 'CSV 匯出' })
  await user.click(within(exportDialog).getByRole('button', { name: '匯出目前篩選結果' }))
  await user.click(within(exportDialog).getByRole('button', { name: '匯出全部記事' }))

  await waitFor(() => expect(client.run).toHaveBeenCalledWith({
    action: 'exportEntries',
    filter: { query: '週會', from: '2026-08-01', to: '2026-08-31', categoryId: 'work', tag: '會議' },
  }))
  expect(client.run).toHaveBeenCalledWith({
    action: 'exportEntries',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  })
})

test('JournalClient 在 TypeScript 層要求 restoreSession', () => {
  // @ts-expect-error JournalClient must restore the server session before bootstrapping.
  const missingRestoreSession: JournalClient = {
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: async <T,>() => bootstrap() as T,
  }

  expect(missingRestoreSession).toBeDefined()
})

test('JournalClient 在 TypeScript 層要求 beginSignIn', () => {
  // @ts-expect-error JournalClient must redirect to the server OAuth route.
  const missingBeginSignIn: JournalClient = {
    restoreSession: async () => true,
    signOut: vi.fn(),
    run: async <T,>() => bootstrap() as T,
  }

  expect(missingBeginSignIn).toBeDefined()
})

function journalClient(
  handler: (request: ApiRequest) => Promise<unknown>,
  authenticated = true,
): JournalClient & {
  restoreSession: ReturnType<typeof vi.fn>
  beginSignIn: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
} {
  return {
    restoreSession: vi.fn().mockResolvedValue(authenticated),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(handler),
  } as JournalClient & {
    restoreSession: ReturnType<typeof vi.fn>
    beginSignIn: ReturnType<typeof vi.fn>
    signOut: ReturnType<typeof vi.fn>
    run: ReturnType<typeof vi.fn>
  }
}

function bootstrap() {
  return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
}

function category(id: string) {
  return {
    id,
    name: id,
    isActive: true,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}

function entry(id: string, entryDate: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    entryDate,
    title: `標題 ${id}`,
    content: `記事內容 ${id}`,
    categoryId: 'work',
    tags: ['會議'],
    links: [],
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
    ...overrides,
  }
}

function entryPage(items: Entry[] = [], nextCursor: string | null = null): EntryListResult {
  return { items, nextCursor }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function JournalTestHarness({ client, onExportError }: { client: JournalClient; onExportError?: (error: unknown) => void }) {
  const journal = useJournal(client)

  return (
    <>
      <p>狀態：{journal.status}</p>
      {journal.entries.map((currentEntry) => <p key={currentEntry.id}>{currentEntry.content}</p>)}
      <button type="button" onClick={journal.signOut}>登出</button>
      <button type="button" onClick={() => void journal.exportEntries('all').catch(onExportError)}>匯出</button>
    </>
  )
}

function DateSelectionHarness({ client }: { client: JournalClient }) {
  const journal = useJournal(client)
  const [ids, setIds] = useState('')

  return (
    <>
      <button type="button" onClick={() => void journal.getEntriesForDate('2026-08-04').then((entries) => setIds(entries?.map((entry) => entry.id).join(',') ?? ''))}>載入 2026-08-04</button>
      <output>{ids}</output>
    </>
  )
}
