import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CalendarView } from './calendar-view'

afterEach(cleanup)

const entries = [
  createEntry('entry-1', '第一則記事'),
  createEntry('entry-2', '第二則記事'),
  createEntry('entry-3', '第三則記事'),
]

test('點選日期框時載入該日資料', async () => {
  const onSelectDate = vi.fn()
  render(
    <CalendarView
      month="2026-08"
      days={[{ date: '2026-08-04', entries: entries.slice(0, 2) }]}
      categories={[]}
      timezone="Asia/Taipei"
      onMonthChange={vi.fn()}
      onSelectDate={onSelectDate}
      onOpenEntry={vi.fn()}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: '2026-08-04，共 2 則記事' }))
  expect(onSelectDate).toHaveBeenCalledWith('2026-08-04')
})

test('點選日期格中的記事會開啟詳細資訊且不選取日期', async () => {
  const user = userEvent.setup()
  const onSelectDate = vi.fn()
  const onOpenEntry = vi.fn()
  render(
    <CalendarView
      month="2026-08"
      days={[{ date: '2026-08-04', entries: entries.slice(0, 2) }]}
      categories={[]}
      timezone="Asia/Taipei"
      onMonthChange={vi.fn()}
      onSelectDate={onSelectDate}
      onOpenEntry={onOpenEntry}
    />,
  )

  await user.click(screen.getByRole('button', { name: '閱讀記事：第一則記事' }))

  expect(onOpenEntry).toHaveBeenCalledWith(entries[0])
  expect(onSelectDate).not.toHaveBeenCalled()
})

test('點選溢出記事可選擇後開啟詳細資訊', async () => {
  const user = userEvent.setup()
  const onOpenEntry = vi.fn()
  render(
    <CalendarView
      month="2026-08"
      days={[{ date: '2026-08-04', entries }]}
      categories={[]}
      timezone="Asia/Taipei"
      onMonthChange={vi.fn()}
      onSelectDate={vi.fn()}
      onOpenEntry={onOpenEntry}
    />,
  )

  await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
  expect(await screen.findByRole('dialog', { name: '2026-08-04 的記事' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '第三則記事' }))

  expect(onOpenEntry).toHaveBeenCalledWith(entries[2])
})

test('日期格和更多清單依類別套用自訂色', async () => {
  const user = userEvent.setup()
  render(
    <CalendarView
      month="2026-08"
      days={[{ date: '2026-08-04', entries }]}
      categories={[{
        id: 'work', name: '工作', color: '#b97c66', isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      timezone="Asia/Taipei"
      onMonthChange={vi.fn()}
      onSelectDate={vi.fn()}
      onOpenEntry={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: '閱讀記事：第一則記事' })).toHaveStyle({ '--category-color': '#b97c66' })
  expect(screen.getByRole('button', { name: '還有 1 則記事' })).not.toHaveAttribute('style')
  await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
  expect(screen.getByRole('button', { name: '第三則記事' })).toHaveStyle({ '--category-color': '#b97c66' })
})

function createEntry(id: string, title: string) {
  return {
    id,
    entryDate: '2026-08-04',
    title,
    content: `${title}內容`,
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: '2026-08-04T09:00:00+08:00',
    updatedAt: '2026-08-04T09:00:00+08:00',
  }
}
