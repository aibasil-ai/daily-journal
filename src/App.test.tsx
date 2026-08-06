// @vitest-environment jsdom

import './test/dialog-setup'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, test, vi } from 'vitest'
import { App } from './App'
import { currentMonth } from './App'
import type { ApiRequest, Category, Entry } from './domain/journal'
import type { JournalClient } from './features/journal/use-journal'

test('顯示每日記事標題', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})

test('月曆預設月份依試算表時區計算', () => {
  expect(currentMonth('America/Los_Angeles', new Date('2026-08-01T00:30:00.000Z'))).toBe('2026-07')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

test('OAuth 失敗 signal 會在未登入畫面顯示固定錯誤與登入按鈕', async () => {
  window.history.replaceState({}, '', '/?login_error=oauth_failed')
  const client = {
    restoreSession: vi.fn().mockResolvedValue(false),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(),
  }

  render(<App client={client} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('無法完成 Google 登入，請再試一次。')
  expect(screen.getByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('切換分類管理時只顯示分類工作區', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient()} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '分類管理' }))

  expect(screen.getByRole('heading', { name: '分類管理' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /月曆/ })).not.toBeInTheDocument()
})

test('月曆日期有一筆記事時直接開啟閱讀視圖', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient({ entriesForDate: [entry('only')] })} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: /2026-08-04/ }))

  expect(await screen.findByRole('dialog', { name: '閱讀記事' })).toHaveTextContent('記事內容 only')
})

test('月曆日期有多筆記事時先顯示選擇視窗', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient({ entriesForDate: [entry('morning'), entry('evening')] })} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: /2026-08-04/ }))

  expect(await screen.findByRole('dialog', { name: '選擇記事' })).toBeInTheDocument()
})

function readyClient({ entriesForDate = [] }: { entriesForDate?: Entry[] } = {}): JournalClient {
  return {
    restoreSession: vi.fn().mockResolvedValue(true),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'getMonthlyEntryCounts') return [{ date: '2026-08-04', count: entriesForDate.length }]
      if (request.action === 'getEntriesForDate') return entriesForDate
      throw new Error(`未預期的請求：${request.action}`)
    }) as JournalClient['run'],
  }
}

function entry(id: string): Entry {
  return {
    id,
    entryDate: '2026-08-04',
    title: `標題 ${id}`,
    content: `記事內容 ${id}`,
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}

function category(id: string): Category {
  return {
    id,
    name: '工作',
    isActive: true,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}
