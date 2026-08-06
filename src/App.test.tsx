// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { App } from './App'
import { currentMonth } from './App'

test('顯示每日記事標題', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})

test('月曆預設月份依試算表時區計算', () => {
  expect(currentMonth('America/Los_Angeles', new Date('2026-08-01T00:30:00.000Z'))).toBe('2026-07')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

test('OAuth 失敗 signal 會在未登入畫面顯示固定錯誤與登入按鈕', async () => {
  window.history.replaceState({}, '', '/?login_error=oauth_failed')
  const client = {
    restoreSession: vi.fn().mockResolvedValue(false),
    beginSignIn: vi.fn(),
    signOut: vi.fn(),
    run: vi.fn(),
  }

  render(<App client={client} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('無法完成 Google 登入，請再試一次。')
  expect(screen.getByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})
