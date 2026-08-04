// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { App } from './App'

test('顯示每日記事標題', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})
