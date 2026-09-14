import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, test, vi } from 'vitest'
import { CalendarMonthView } from './calendar-month-view'

afterEach(cleanup)

const entries = [
  createEntry('entry-1', '第一則記事'),
  createEntry('entry-2', '第二則記事'),
  createEntry('entry-3', '第三則記事'),
]

const defaultProps = {
  anchorDate: '2026-08-04',
  today: '2026-08-04',
  days: [{ date: '2026-08-04', entries }],
  categories: [],
  onFocusDate: vi.fn(),
  onSelectDate: vi.fn(),
  onOpenEntry: vi.fn(),
}

it('點選日期框時載入該日資料', async () => {
  const user = userEvent.setup()
  render(<CalendarMonthView {...defaultProps} />)

  expect(screen.getByRole('grid', { name: '2026年8月' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^2026-08-04，共 3 則記事/ }))
  expect(defaultProps.onFocusDate).toHaveBeenCalledWith('2026-08-04')
  expect(defaultProps.onSelectDate).toHaveBeenCalledWith('2026-08-04')
})

it('點選日期格中的記事會開啟詳細資訊且不選取日期', async () => {
  const user = userEvent.setup()
  render(<CalendarMonthView {...defaultProps} />)

  await user.click(screen.getByRole('button', { name: '閱讀記事：第一則記事' }))
  expect(defaultProps.onFocusDate).toHaveBeenCalledWith('2026-08-04')
  expect(defaultProps.onOpenEntry).toHaveBeenCalledWith(entries[0])
})

it('點選溢出記事可選擇後開啟詳細資訊', async () => {
  const user = userEvent.setup()
  render(<CalendarMonthView {...defaultProps} />)

  await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
  expect(await screen.findByRole('dialog', { name: '2026-08-04 的記事' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '第三則記事' }))

  expect(defaultProps.onFocusDate).toHaveBeenCalledWith('2026-08-04')
  expect(defaultProps.onOpenEntry).toHaveBeenCalledWith(entries[2])
})

it('日期格和更多清單依類別套用自訂色', async () => {
  const user = userEvent.setup()
  render(
    <CalendarMonthView
      {...defaultProps}
      categories={[{
        id: 'work', name: '工作', color: '#b97c66', isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
    />,
  )

  const firstEntry = screen.getByRole('button', { name: '閱讀記事：第一則記事' })
  expect(firstEntry.closest('[role="gridcell"]')).toHaveClass('calendar-grid__cell--has-entries')
  expect(firstEntry).toHaveStyle({ '--category-color': '#b97c66' })
  expect(screen.getByRole('button', { name: '還有 1 則記事' })).not.toHaveAttribute('style')
  await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
  expect(screen.getByRole('button', { name: '第三則記事' })).toHaveStyle({ '--category-color': '#b97c66' })
})

it('對今日與焦點日期顯示提示並標記目前日期', () => {
  render(<CalendarMonthView {...defaultProps} />)

  const today = screen.getByRole('button', { name: /2026-08-04.*今天.*焦點日期/ })
  expect(today).toHaveAttribute('aria-current', 'date')
  expect(today).toHaveClass('calendar-day--today', 'calendar-day--focused')
})

it('空白日期停用且不標記為有記事', () => {
  render(<CalendarMonthView {...defaultProps} />)

  const emptyDate = screen.getByRole('button', { name: '2026-08-05，共 0 則記事' })
  expect(emptyDate).toBeDisabled()
  expect(emptyDate.closest('[role="gridcell"]')).not.toHaveClass('calendar-grid__cell--has-entries')
})

test('西元 0 至 99 年仍建立正確月份日期', () => {
  render(
    <CalendarMonthView
      {...defaultProps}
      anchorDate="0099-02-03"
      today="2026-09-03"
      days={[]}
    />,
  )

  expect(screen.getByRole('grid', { name: '99年2月' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '0099-02-28，共 0 則記事' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /0099-02-29/ })).not.toBeInTheDocument()
})

it('溢出記事清單按鈕具備 title 提示與專屬標題類別以支援文字換行', async () => {
  const user = userEvent.setup()
  const longTitle = 'BPW 官方網站 什麼是剪輯？掌握影片剪輯的主要工作流程與基礎觀念'
  const testEntries = [
    createEntry('e-1', '記事一'),
    createEntry('e-2', '記事二'),
    createEntry('e-3', longTitle),
  ]

  render(
    <CalendarMonthView
      {...defaultProps}
      days={[{ date: '2026-08-04', entries: testEntries }]}
    />,
  )

  await user.click(screen.getByRole('button', { name: '還有 1 則記事' }))
  const longEntryButton = await screen.findByRole('button', { name: longTitle })
  expect(longEntryButton).toHaveAttribute('title', longTitle)

  const titleSpan = longEntryButton.querySelector('.calendar-entry-picker__title')
  expect(titleSpan).toBeInTheDocument()
  expect(titleSpan).toHaveTextContent(longTitle)
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