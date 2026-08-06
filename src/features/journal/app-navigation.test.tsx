// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, expect, test } from 'vitest'
import { AppNavigation } from './app-navigation'

test('導覽點選月曆、建立、匯出與登出時傳出對應 callback', async () => {
  const onViewChange = vi.fn()
  const onCreateEntry = vi.fn()
  const onExport = vi.fn()
  const onSignOut = vi.fn()
  const user = userEvent.setup()

  render(<AppNavigation view="timeline" onViewChange={onViewChange} onCreateEntry={onCreateEntry} onExport={onExport} onSignOut={onSignOut} />)
  const sidebar = within(screen.getByRole('navigation', { name: '主要導覽' }))
  await user.click(sidebar.getByRole('button', { name: '月曆' }))
  await user.click(screen.getByRole('button', { name: '新增記事' }))
  await user.click(screen.getByRole('button', { name: '匯出資料' }))
  await user.click(screen.getByRole('button', { name: '登出' }))

  expect(onViewChange).toHaveBeenCalledWith('calendar')
  expect(onCreateEntry).toHaveBeenCalledOnce()
  expect(onExport).toHaveBeenCalledOnce()
  expect(onSignOut).toHaveBeenCalledOnce()
})

test('僅將目前視圖標示為目前頁面', () => {
  render(<AppNavigation view="calendar" onViewChange={vi.fn()} onCreateEntry={vi.fn()} onExport={vi.fn()} onSignOut={vi.fn()} />)

  const sidebar = within(screen.getByRole('navigation', { name: '主要導覽' }))
  expect(sidebar.getByRole('button', { name: '時間軸' })).not.toHaveAttribute('aria-current')
  expect(sidebar.getByRole('button', { name: '月曆' })).toHaveAttribute('aria-current', 'page')
  expect(sidebar.getByRole('button', { name: '分類管理' })).not.toHaveAttribute('aria-current')
})

test('行動導覽列只提供三個主要視圖', () => {
  render(<AppNavigation view="timeline" onViewChange={vi.fn()} onCreateEntry={vi.fn()} onExport={vi.fn()} onSignOut={vi.fn()} />)

  const mobileBar = within(screen.getByRole('navigation', { name: '行動主要導覽' }))
  expect(mobileBar.getByRole('button', { name: '時間軸' })).toBeInTheDocument()
  expect(mobileBar.getByRole('button', { name: '月曆' })).toBeInTheDocument()
  expect(mobileBar.getByRole('button', { name: '分類管理' })).toBeInTheDocument()
  expect(mobileBar.queryByRole('button', { name: '匯出資料' })).not.toBeInTheDocument()
  expect(mobileBar.queryByRole('button', { name: '登出' })).not.toBeInTheDocument()
})

test('新版應用殼層保留桌面側欄與行動底部導覽 class', () => {
  render(<AppNavigation view="timeline" onViewChange={vi.fn()} onCreateEntry={vi.fn()} onExport={vi.fn()} onSignOut={vi.fn()} />)

  expect(screen.getByRole('navigation', { name: '主要導覽' }).className).toContain('app-navigation__sidebar')
  expect(screen.getByRole('navigation', { name: '行動主要導覽' }).className).toContain('app-navigation__mobile')
})
