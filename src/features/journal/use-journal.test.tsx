import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from '../../App'
import type { JournalClient } from './use-journal'
import { AuthenticationError, ExecutionClientError } from '../../services/execution-client'

afterEach(() => {
  delete window.__JOURNAL_CONFIG__
  vi.unstubAllGlobals()
})

test('缺少部署設定時顯示完整處理指引', async () => {
  vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', { googleClientId: '', gasScriptId: '' })

  render(<App />)

  expect(await screen.findByRole('heading', { name: '部署設定有誤' })).toBeInTheDocument()
  expect(screen.getByText('找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_SCRIPT_ID，或建立 public/app-config.js。')).toBeInTheDocument()
})

test('登入後載入啟用分類並進入首頁', async () => {
  const calls: string[] = []
  const client = {
    signIn: vi.fn().mockImplementation(async () => {
      calls.push('signIn')
    }),
    run: vi.fn().mockImplementation(async () => {
      calls.push('run')
      return {
        timezone: 'Asia/Taipei',
        categories: [category('work'), category('archived', false)],
        tagSuggestions: ['會議'],
      }
    }),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).not.toBeInTheDocument()
  expect(calls).toEqual(['signIn', 'run'])
})

test('JournalClient 在 TypeScript 層要求 signIn', () => {
  // @ts-expect-error JournalClient must reject a client that cannot authorize bootstrap.
  const missingSignIn: JournalClient = {
    run: async () => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }),
  }

  expect(missingSignIn).toBeDefined()
})

test('登入取消時顯示重新登入指引', async () => {
  const client = {
    signIn: vi.fn().mockRejectedValue(new Error('Google 登入或授權未完成。')),
    run: vi.fn(),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('Google 登入或授權未完成。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
  expect(client.run).not.toHaveBeenCalled()
})

test('GAS 權限錯誤顯示重新登入指引', async () => {
  const client = { signIn: vi.fn().mockResolvedValue(undefined), run: vi.fn().mockRejectedValue(new AuthenticationError()) }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('登入已過期或沒有 GAS 使用權限，請重新登入。')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '連線至每日記事' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
})

test('網路錯誤顯示可重新嘗試的指引', async () => {
  const client = { signIn: vi.fn().mockResolvedValue(undefined), run: vi.fn()
    .mockRejectedValueOnce(new ExecutionClientError())
    .mockResolvedValueOnce({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }) }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('暫時無法連線至服務，請稍後再試。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '重新嘗試' }))

  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
})

test('GIS SDK 未載入時顯示重新登入與重新嘗試指引', async () => {
  vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', { googleClientId: 'client-id', gasScriptId: 'script-id' })
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('Google 登入服務尚未載入。請確認網路連線後重新整理頁面，再重新登入。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
})

test('連線中停用登入按鈕並顯示連線狀態', async () => {
  let resolveBootstrap: ((value: { timezone: string; categories: ReturnType<typeof category>[]; tagSuggestions: string[] }) => void) | undefined
  const client = {
    signIn: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveBootstrap = resolve
    })),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(screen.getByRole('button', { name: '連線中...' })).toBeDisabled()
  resolveBootstrap?.({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] })
  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
})

function category(id: string, isActive = true) {
  return {
    id,
    name: id,
    isActive,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}
