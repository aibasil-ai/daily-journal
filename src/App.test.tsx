import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiRequest } from './domain/journal'
import { App } from './App'
import type { JournalClient } from './features/journal/use-journal'

afterEach(cleanup)

test('登入後載入啟用分類並進入首頁', async () => {
  const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') {
        return {
          timezone: 'Asia/Taipei',
          categories: [{
            id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
          }],
          tagSuggestions: [],
        }
      }
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'listCategories') return []
      if (request.action === 'getMonthlyEntryCounts') return []
      throw new Error(`未預期的請求：${request.action}`)
    })
  const client: JournalClient = {
    run: run as JournalClient['run'],
  }

  render(<App client={client} />)
  await userEvent.click(screen.getByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByRole('heading', { name: '每日記事' })).toBeInTheDocument()
  expect(run).toHaveBeenCalledWith({ action: 'bootstrap' })
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
    if (request.action === 'listCategories') return [category]
    if (request.action === 'listEntries') return { items: [savedEntry] }
    if (request.action === 'saveEntry') return savedEntry
    throw new Error(`未預期的請求：${request.action}`)
  })

  render(<App client={{ run: run as JournalClient['run'] }} />)
  await user.click(screen.getByRole('button', { name: '使用 Google 帳號登入' }))
  await screen.findByRole('heading', { name: '每日記事' })
  await user.click(screen.getAllByRole('button', { name: '新增記事' })[0])
  await user.type(screen.getByLabelText('記事內容'), savedEntry.content)
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'saveEntry' }))
})
