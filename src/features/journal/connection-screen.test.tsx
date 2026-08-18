import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ConnectionScreen } from './connection-screen'

afterEach(cleanup)

test('顯示品牌登入頁並啟動 Google 登入', async () => {
  const onSignIn = vi.fn()
  render(<ConnectionScreen status="signed-out" onSignIn={onSignIn} onRetry={vi.fn()} />)

  expect(screen.getByLabelText('每日記事品牌')).toBeInTheDocument()
  expect(screen.getAllByText('書寫此刻・珍藏日常')).toHaveLength(2)
  expect(screen.getByRole('heading', { name: '把今天，寫進時光裡' })).toBeInTheDocument()
  expect(screen.getByText('透過 Google 帳號安全登入，讓每段日常都收藏在您的個人 Google Sheets。')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '使用 Google 帳號登入' }))
  expect(onSignIn).toHaveBeenCalledOnce()
})

test('錯誤狀態顯示原因並可重新嘗試', async () => {
  const onRetry = vi.fn()
  render(<ConnectionScreen status="error" error="無法連線" onSignIn={vi.fn()} onRetry={onRetry} />)

  expect(screen.getByRole('alert')).toHaveTextContent('無法連線')
  await userEvent.click(screen.getByRole('button', { name: '重新嘗試' }))
  expect(onRetry).toHaveBeenCalledOnce()
})

test('檢查工作階段時停用登入按鈕', () => {
  render(<ConnectionScreen status="checking-session" onSignIn={vi.fn()} onRetry={vi.fn()} />)

  expect(screen.getByRole('button', { name: '連線中...' })).toBeDisabled()
})
