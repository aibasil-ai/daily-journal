import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CalendarDayView } from './calendar-day-view'

afterEach(cleanup)

const entry = {
  id: 'entry-1', entryDate: '2026-09-03', title: '第一則記事', content: '完整摘要內容', categoryId: 'work',
  tags: ['會議', '專案'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
}
const category = {
  id: 'work', name: '工作', color: '#b97c66' as const, isActive: true,
  createdAt: '2026-09-03T00:00:00+08:00', updatedAt: '2026-09-03T00:00:00+08:00',
}

test('顯示完整摘要卡並傳遞詳情、編輯、刪除與指定日期新增', async () => {
  const user = userEvent.setup()
  const onOpenEntry = vi.fn()
  const onEditEntry = vi.fn()
  const onDeleteEntry = vi.fn().mockResolvedValue(undefined)
  const onCreateEntry = vi.fn()
  render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-03"
      entries={[entry]}
      categories={[category]}
      timezone="Asia/Taipei"
      onOpenEntry={onOpenEntry}
      onEditEntry={onEditEntry}
      onDeleteEntry={onDeleteEntry}
      onCreateEntry={onCreateEntry}
    />,
  )

  expect(screen.getByText('完整摘要內容')).toBeInTheDocument()
  expect(screen.getByText('#會議')).toBeInTheDocument()
  expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
  await user.click(screen.getByRole('button', { name: '閱讀記事：第一則記事' }))
  await user.click(screen.getByRole('button', { name: '編輯 第一則記事' }))
  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '永久刪除' }))
  await user.click(screen.getByRole('button', { name: '新增這天的記事' }))
  expect(onOpenEntry).toHaveBeenCalledWith(entry)
  expect(onEditEntry).toHaveBeenCalledWith(entry)
  expect(onDeleteEntry).toHaveBeenCalledWith('entry-1')
  expect(onCreateEntry).toHaveBeenCalledWith('2026-09-03')
})

test('空白日仍可新增指定日期記事', async () => {
  const onCreateEntry = vi.fn()
  render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-04"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={onCreateEntry}
    />,
  )

  expect(screen.getByText('這天還沒有符合條件的記事')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '新增這天的記事' }))
  expect(onCreateEntry).toHaveBeenCalledWith('2026-09-03')
})

test('焦點日是今天時提供可見且可讀的非顏色提示', () => {
  const { rerender } = render(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-03"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={vi.fn()}
    />,
  )

  expect(screen.getByText('今天')).toHaveAttribute('aria-current', 'date')
  expect(screen.getByText('焦點日期')).toBeInTheDocument()
  rerender(
    <CalendarDayView
      date="2026-09-03"
      today="2026-09-04"
      entries={[]}
      categories={[]}
      timezone="Asia/Taipei"
      onOpenEntry={vi.fn()}
      onEditEntry={vi.fn()}
      onDeleteEntry={vi.fn().mockResolvedValue(undefined)}
      onCreateEntry={vi.fn()}
    />,
  )
  expect(screen.queryByText('今天')).not.toBeInTheDocument()
  expect(screen.getByText('焦點日期')).toBeInTheDocument()
})