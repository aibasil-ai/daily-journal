import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { EntryCard } from './entry-card'

afterEach(cleanup)

test('刪除前顯示原生確認對話框，且初始焦點停在取消按鈕', async () => {
  const user = userEvent.setup()
  render(
    <EntryCard
      entry={{
        id: 'entry-1',
        entryDate: '2026-08-04',
        title: '測試記事',
        content: '內容',
        categoryId: 'work',
        tags: [],
        links: [],
        createdAt: '2026-08-04T09:00:00+08:00',
        updatedAt: '2026-08-04T09:00:00+08:00',
      }}
      categoryName="工作"
      categoryColor={null}
      timezone="Asia/Taipei"
      onOpen={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  expect(await screen.findByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
})

test('自訂類別色會套用到時間軸標籤', () => {
  render(
    <EntryCard
      entry={{
        id: 'entry-1', entryDate: '2026-08-04', title: '測試記事', content: '內容', categoryId: 'work',
        tags: [], links: [], createdAt: '2026-08-04T09:00:00+08:00', updatedAt: '2026-08-04T09:00:00+08:00',
      }}
      categoryName="工作"
      categoryColor="#b97c66"
      timezone="Asia/Taipei"
      onOpen={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  const badge = screen.getAllByText('工作').at(-1)!
  expect(badge).toHaveClass('category-badge--custom-color')
  expect(badge).toHaveStyle({ '--category-color': '#b97c66' })
})
