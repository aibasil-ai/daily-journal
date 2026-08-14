import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { CalendarView } from './calendar-view'

test('點選有兩則記事的日期時載入該日資料', async () => {
  const onSelectDate = vi.fn()
  render(
    <CalendarView
      month="2026-08"
      counts={[{ date: '2026-08-04', count: 2 }]}
      timezone="Asia/Taipei"
      onMonthChange={vi.fn()}
      onSelectDate={onSelectDate}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: '2026-08-04，共 2 則記事' }))
  expect(onSelectDate).toHaveBeenCalledWith('2026-08-04')
})
