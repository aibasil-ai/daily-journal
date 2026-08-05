// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
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

test('以週一為首日顯示 ISO 月份、每日記事數量並切換月份', async () => {
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

test('八月首日排在週一開頭的第六欄', () => {
  const { container } = render(
    <CalendarView month="2026-08" counts={[]} onMonthChange={vi.fn()} onSelectDate={vi.fn()} />,
  )

  const days = container.querySelector('.calendar-view__days')

  expect(days?.children).toHaveLength(36)
  expect(days?.children[5]).toHaveAccessibleName('2026-08-01，共 0 則記事')
})
