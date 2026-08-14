import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ApiRequest } from './domain/journal'
import { App } from './App'
import type { JournalClient } from './features/journal/use-journal'

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
