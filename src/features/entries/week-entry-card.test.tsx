import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { WeekEntryCard } from './week-entry-card'

afterEach(cleanup)

test('只顯示精簡資訊、前兩標籤並開啟詳情', async () => {
  const onOpen = vi.fn()
  render(
    <WeekEntryCard
      entry={{
        id: 'entry-1', entryDate: '2026-09-03', title: '週記事', content: '兩行摘要內容', categoryId: 'work',
        tags: ['一', '二', '三'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
      }}
      categoryName="工作"
      categoryColor="#b97c66"
      onOpen={onOpen}
    />,
  )

  expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
  expect(screen.getByText('週記事')).toBeInTheDocument()
  expect(screen.getByText('兩行摘要內容')).toBeInTheDocument()
  expect(screen.getByText('#一')).toBeInTheDocument()
  expect(screen.getByText('#二')).toBeInTheDocument()
  expect(screen.queryByText('#三')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /編輯|刪除/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '閱讀記事：週記事' }))
  expect(onOpen).toHaveBeenCalledOnce()
})