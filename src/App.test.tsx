// @vitest-environment jsdom

import './test/dialog-setup'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

test('時間軸頁首提供可搜尋記事的輸入框', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient()} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '時間軸' }))

  expect(screen.getByRole('heading', { name: '時間軸' })).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: '關鍵字' })).toHaveAttribute('placeholder', '搜尋記事...')
})

test('月曆預設月份依試算表時區計算', () => {
  expect(currentMonth('America/Los_Angeles', new Date('2026-08-01T00:30:00.000Z'))).toBe('2026-07')
})

test('月曆工作區提供月份標題與今天操作', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient()} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))

  expect(screen.getByRole('heading', { name: /月曆/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument()
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

test('行動操作可新增、匯出並登出', async () => {
  const client = readyClient()
  const user = userEvent.setup()
  render(<App client={client} />)

  const mobileActions = within(await screen.findByRole('group', { name: '行動操作' }))
  await user.click(mobileActions.getByRole('button', { name: '新增記事' }))
  expect(await screen.findByRole('dialog', { name: '新增記事' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '關閉' }))

  await user.click(mobileActions.getByRole('button', { name: '行動操作' }))
  await user.click(mobileActions.getByRole('button', { name: '匯出資料' }))
  expect(await screen.findByRole('dialog', { name: 'CSV 匯出' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '關閉' }))

  await user.click(mobileActions.getByRole('button', { name: '行動操作' }))
  await user.click(mobileActions.getByRole('button', { name: '登出' }))

  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(client.signOut).toHaveBeenCalledOnce()
})

test('關閉閱讀視窗會先將焦點還給穩定的 App 主區域', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient({ entriesForDate: [entry('only')] })} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: /2026-08-04/ }))
  const reader = await screen.findByRole('dialog', { name: '閱讀記事' })
  await user.click(within(reader).getByRole('button', { name: '關閉' }))

  await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  expect(screen.queryByRole('dialog', { name: '閱讀記事' })).not.toBeInTheDocument()
})

test('成功刪除閱讀中的記事後將焦點還給穩定的 App 主區域', async () => {
  const user = userEvent.setup()
  render(<App client={readyClient({ entriesForDate: [entry('only')] })} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: /2026-08-04/ }))
  const reader = await screen.findByRole('dialog', { name: '閱讀記事' })
  await user.click(within(reader).getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  expect(screen.queryByRole('dialog', { name: '閱讀記事' })).not.toBeInTheDocument()
})

test('月曆日期請求在切換離開再回到月曆後完成時不開啟過期閱讀視窗', async () => {
  const selection = pendingPromise<Entry[]>()
  const client = readyClient({ entriesForDatePromise: selection.promise })
  const user = userEvent.setup()
  render(<App client={client} />)
  const mobileNavigation = await screen.findByRole('navigation', { name: '行動主要導覽' })

  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: /2026-08-04/ }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getEntriesForDate', date: '2026-08-04' })))
  await user.click(within(mobileNavigation).getByRole('button', { name: '時間軸' }))
  await user.click(within(mobileNavigation).getByRole('button', { name: '月曆' }))

  await act(async () => {
    selection.resolve([entry('stale')])
    await selection.promise
  })

  expect(screen.queryByRole('dialog', { name: '閱讀記事' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '選擇記事' })).not.toBeInTheDocument()
})

function readyClient({ entriesForDate = [], entriesForDatePromise }: { entriesForDate?: Entry[], entriesForDatePromise?: Promise<Entry[]> } = {}): JournalClient {
  return {
    restoreSession: vi.fn().mockResolvedValue(true),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'getMonthlyEntryCounts') return [{ date: '2026-08-04', count: entriesForDate.length }]
      if (request.action === 'getEntriesForDate') return entriesForDatePromise ?? entriesForDate
      if (request.action === 'deleteEntry') return undefined
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

function pendingPromise<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}
