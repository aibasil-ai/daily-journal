// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { CalendarView } from './calendar-view'

test('點選有兩則記事的日期時載入該日資料', async () => {
  const onSelectDate = vi.fn()
  const user = userEvent.setup()

  render(<CalendarView month="2026-08" counts={[{ date: '2026-08-04', count: 2 }]} onMonthChange={vi.fn()} onSelectDate={onSelectDate} />)

  await user.click(screen.getByRole('button', { name: '2026-08-04，共 2 則記事' }))

  expect(onSelectDate).toHaveBeenCalledWith('2026-08-04')
})

test('月曆只顯示每日數量 badge，不顯示記事標題', () => {
  render(<CalendarView month="2026-08" counts={[{ date: '2026-08-04', count: 2 }]} onMonthChange={vi.fn()} onSelectDate={vi.fn()} />)

  expect(screen.getByText('2 則記事')).toBeInTheDocument()
  expect(screen.queryByText('標題 morning')).not.toBeInTheDocument()
})

test('月曆頁首顯示本月摘要並可回到今天', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-07T12:00:00.000Z'))
  const onMonthChange = vi.fn()

  try {
    render(<CalendarView month="2026-06" counts={[{ date: '2026-06-04', count: 2 }]} onMonthChange={onMonthChange} onSelectDate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /月曆/ })).toBeInTheDocument()
    expect(screen.getByText('本月共有 2 篇記事')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(onMonthChange).toHaveBeenCalledWith('2026-08')
  } finally {
    vi.useRealTimers()
  }
})

test('以週日為首日顯示 ISO 月份、每日記事數量並切換月份', async () => {
  const onMonthChange = vi.fn()
  const user = userEvent.setup()

  render(<CalendarView month="2026-08" counts={[{ date: '2026-08-04', count: 2 }]} onMonthChange={onMonthChange} onSelectDate={vi.fn()} />)

  expect(screen.getByRole('heading', { name: '2026-08 月曆' })).toBeInTheDocument()
  expect(screen.getAllByText('一')).toHaveLength(1)
  expect(screen.getByText('2 則記事')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2026-08-01，共 0 則記事' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '下個月' }))

  expect(onMonthChange).toHaveBeenCalledWith('2026-09')
})

test('八月首日排在週日開頭的第七欄', () => {
  const { container } = render(
    <CalendarView month="2026-08" counts={[]} onMonthChange={vi.fn()} onSelectDate={vi.fn()} />,
  )

  const days = container.querySelector('.calendar-view__days')

  expect(days?.children).toHaveLength(42)
  expect(days?.children[6]).toHaveAccessibleName('2026-08-01，共 0 則記事')
})
