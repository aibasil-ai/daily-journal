import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiRequest } from './domain/journal'
import { App } from './App'
import type { JournalClient } from './features/journal/use-journal'

afterEach(cleanup)

test('恢復有效 session 後載入啟用分類並進入首頁', async () => {
  const user = userEvent.setup()
  const categories = [{
    id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }]
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') {
      return {
        timezone: 'Asia/Taipei',
        categories,
        tagSuggestions: [],
      }
    }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'listCategories') return { categories, entryCounts: { work: 3 } }
    if (request.action === 'getMonthlyEntries') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client: JournalClient = {
    restoreSession: async () => ({
      state: 'authenticated',
      user: { name: 'Alice' },
      connection: { spreadsheetId: 'sheet-1', spreadsheetName: '我的日記', status: 'active', connectionVersion: 1 },
    }),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: run as JournalClient['run'],
  }

  render(<App client={client} />)

  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'bootstrap' }))
  expect(await screen.findByRole('heading', { name: '每日記事' })).toBeInTheDocument()
  expect(run).toHaveBeenCalledWith({ action: 'bootstrap' })
  await user.click(screen.getAllByRole('button', { name: '類別管理' })[0])
  expect(await screen.findByText('3 則記事')).toBeInTheDocument()
})

test('GAS 省略空白分頁游標時仍可儲存記事', async () => {
  const user = userEvent.setup()
  const category = {
    id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }
  const savedEntry = {
    id: 'entry-1', entryDate: '2026-08-04', title: '', content: '完成測試', categoryId: 'work', tags: [], links: [],
    createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') {
      return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 0 } }
    if (request.action === 'listEntries') return { items: [savedEntry] }
    if (request.action === 'getMonthlyEntries') return []
    if (request.action === 'saveEntry') return savedEntry
    throw new Error(`未預期的請求：${request.action}`)
  })

  render(<App client={{
    restoreSession: async () => ({ state: 'authenticated' }),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: run as JournalClient['run'],
  }} />)
  await screen.findByRole('heading', { name: '每日記事' })
  await user.click(screen.getAllByRole('button', { name: '新增記事' })[0])
  await user.type(screen.getByLabelText('記事內容'), savedEntry.content)
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'saveEntry' }))
})

test('登入按鈕只啟動伺服器端 OAuth 流程', async () => {
  const beginSignIn = vi.fn()
  const run = vi.fn()
  render(<App client={{
    restoreSession: async () => ({ state: 'signed-out' }),
    beginSignIn,
    signOut: vi.fn(),
    run: run as JournalClient['run'],
  }} />)

  await userEvent.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(beginSignIn).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
})

test('登出立即清除畫面並呼叫 server session 登出', async () => {
  const user = userEvent.setup()
  const signOut = vi.fn()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={{
    restoreSession: async () => ({ state: 'authenticated' }),
    beginSignIn: vi.fn(),
    signOut,
    run: run as JournalClient['run'],
  }} />)

  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'bootstrap' }))
  await user.click(screen.getAllByRole('button', { name: '登出' })[0])

  expect(signOut).toHaveBeenCalledOnce()
  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('進入設定頁面可查看目前連結的 Google Sheet', async () => {
  const user = userEvent.setup()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={{
    restoreSession: async () => ({
      state: 'authenticated',
      user: { name: 'Bob', email: 'bob@example.com' },
      connection: { spreadsheetId: 'sheet-xyz', spreadsheetName: '我的專屬日記', status: 'active', connectionVersion: 1 },
    }),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: run as JournalClient['run'],
  }} />)

  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'bootstrap' }))
  await user.click(screen.getAllByRole('button', { name: '設定' })[0])

  expect(await screen.findByText('我的專屬日記')).toBeInTheDocument()
  expect(await screen.findByText(/sheet-xyz/)).toBeInTheDocument()
})

