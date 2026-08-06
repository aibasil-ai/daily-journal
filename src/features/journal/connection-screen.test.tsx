// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ConnectionScreen } from './connection-screen'

test('未登入畫面使用新版連線容器與登入動作', () => {
  render(<ConnectionScreen status="signed-out" onSignIn={vi.fn()} onRetry={vi.fn()} />)

  expect(screen.getByRole('region', { name: '連線至每日記事' }).className).toContain('connection-screen--centered')
  expect(screen.getByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})
