import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { Entry } from '../../domain/journal'
import { CalendarWeekView } from './calendar-week-view'

afterEach(cleanup)

const entries: Entry[] = Array.from({ length: 5 }, (_, index) => ({
  id: `entry-${index + 1}`,
  entryDate: '2026-09-03',
  title: `第 ${index + 1} 則記事`,
  content: `第 ${index + 1} 則內容`,
  categoryId: 'work',
  tags: ['會議', '專案', '其他'],
  links: [],
  createdAt: `2026-09-03T0${index + 1}:00:00+08:00`,
  updatedAt: `2026-09-03T0${index + 1}:00:00+08:00`,
}))

const category = {
  id: 'work',
  name: '工作',
  color: '#b97c66' as const,
  isActive: true,
  createdAt: '2026-09-03T00:00:00+08:00',
  updatedAt: '2026-09-03T00:00:00+08:00',
}

const props = {
  anchorDate: '2026-09-03',
  today: '2026-09-03',
  days: [{ date: '2026-09-03', entries }],
  categories: [category],
  expansionResetKey: 'week-a',
  onFocusDate: vi.fn(),
  onOpenEntry: vi.fn(),
  onCreateEntry: vi.fn(),
}

test('依週一到週日呈現七個具關聯標題的日期區段', () => {
  render(<CalendarWeekView {...props} anchorDate="2026-09-03" today="2026-09-03" />)

  const sections = screen.getAllByRole('region', { name: /星期[一二三四五六日]/ })
  expect(sections).toHaveLength(7)
  for (const section of sections) {
    const headingId = section.getAttribute('aria-labelledby')
    expect(headingId).toBeTruthy()
    expect(document.getElementById(headingId!)).toHaveProperty('tagName', 'H3')
  }
  expect(screen.getByRole('region', { name: /9月3日.*今天.*焦點日期/ })).toBeInTheDocument()
})

test('每天先顯示三則並可原地展開、收合及依 resetKey 重設', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<CalendarWeekView {...props} expansionResetKey="week-a" />)

  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)
  const expand = screen.getByRole('button', { name: '還有 2 則' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(expand).toHaveAttribute('aria-controls')
  await user.click(expand)
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(5)
  expect(screen.getByRole('button', { name: '收合' })).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByRole('button', { name: '收合' }))
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)

  await user.click(screen.getByRole('button', { name: '還有 2 則' }))
  rerender(<CalendarWeekView {...props} expansionResetKey="week-b" />)
  expect(screen.getAllByRole('button', { name: /閱讀記事/ })).toHaveLength(3)
})

test('每一天都可新增並先更新焦點日期', async () => {
  const user = userEvent.setup()
  render(<CalendarWeekView {...props} />)

  await user.click(screen.getByRole('button', { name: /星期二.*9月1日/ }))
  expect(props.onFocusDate).toHaveBeenCalledWith('2026-09-01')
  props.onFocusDate.mockClear()

  await user.click(screen.getByRole('button', { name: '新增 2026-09-01 的記事' }))
  expect(props.onFocusDate).toHaveBeenCalledWith('2026-09-01')
  expect(props.onCreateEntry).toHaveBeenCalledWith('2026-09-01')
})