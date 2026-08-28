import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Timeline } from './timeline'

test('依 categoryId 將目前類別名稱與色彩傳給記事標籤', () => {
  render(
    <Timeline
      entries={[{
        id: 'entry-1', entryDate: '2026-08-04', title: '', content: '自訂色記事', categoryId: 'work',
        tags: [], links: [], createdAt: '2026-08-04T09:00:00+08:00', updatedAt: '2026-08-04T09:00:00+08:00',
      }]}
      categories={[{
        id: 'work', name: '工作', color: '#b97c66', isActive: false,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      timezone="Asia/Taipei"
      nextCursor={null}
      onLoadMore={vi.fn()}
      onOpen={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onCreate={vi.fn()}
    />,
  )

  expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
})
