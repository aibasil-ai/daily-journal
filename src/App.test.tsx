// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { App } from './App'
import { currentMonth } from './App'

test('顯示每日記事標題', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})

test('月曆預設月份依試算表時區計算', () => {
  expect(currentMonth('America/Los_Angeles', new Date('2026-08-01T00:30:00.000Z'))).toBe('2026-07')
})
