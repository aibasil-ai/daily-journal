// @vitest-environment jsdom

import '../../test/dialog-setup'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from '../../App'
import type { Entry, EntryFilter, EntryInput, EntryListResult } from '../../domain/journal'
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
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      calls.push('run')
      if (request.action === 'listEntries') return entryPage()
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
  expect(calls).toEqual(['signIn', 'run', 'run'])
})

test('登入授權完成前不呼叫 bootstrap', async () => {
  let resolveSignIn: (() => void) | undefined
  const client = {
    signIn: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSignIn = resolve
    })),
    run: vi.fn().mockImplementation(async (request: { action: string }) => (
      request.action === 'listEntries'
        ? entryPage()
        : { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    )),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(client.signIn).toHaveBeenCalledOnce()
  expect(client.run).not.toHaveBeenCalled()

  resolveSignIn?.()

  await waitFor(() => expect(client.run).toHaveBeenCalledWith({ action: 'bootstrap' }))
})

test('JournalClient 在 TypeScript 層要求 signIn', () => {
  // @ts-expect-error JournalClient must reject a client that cannot authorize bootstrap.
  const missingSignIn: JournalClient = {
    run: async <T,>() => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }) as T,
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
    .mockResolvedValueOnce({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] })
    .mockResolvedValueOnce(entryPage()) }
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

test('連線後載入、儲存、追加與刪除時間軸記事', async () => {
  const first = entry('first', '2026-08-04')
  const second = entry('second', '2026-08-03')
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter; entry?: EntryInput; id?: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: ['會議'] }
    if (request.action === 'listEntries' && request.filter?.cursor === null) return entryPage([first], 'page-2')
    if (request.action === 'listEntries' && request.filter?.cursor === 'page-2') return entryPage([second])
    if (request.action === 'saveEntry') return entry('saved', request.entry?.entryDate ?? '2026-08-04', { ...request.entry, id: 'saved' })
    if (request.action === 'deleteEntry') return undefined
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), run }} />)
  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(await screen.findByText('記事內容 first')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '載入更多' }))
  expect(await screen.findByText('記事內容 second')).toBeInTheDocument()

  await user.type(screen.getByLabelText('記事內容'), '新記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))
  expect(await screen.findByRole('heading', { name: '新記事' })).toBeInTheDocument()

  const savedCard = screen.getByRole('heading', { name: '新記事' }).closest('article')
  await user.click(within(savedCard!).getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '新記事' })).not.toBeInTheDocument())
})

test('套用篩選時只採用最新請求的項目並重設游標', async () => {
  const resolvers = new Map<string, (value: EntryListResult) => void>()
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries' && !request.filter?.query) return entryPage()
    if (request.action === 'listEntries') return new Promise((resolve) => {
      resolvers.set(request.filter?.query ?? '', resolve)
    })
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), run }} />)
  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))
  await screen.findByRole('searchbox', { name: '關鍵字' })

  await user.type(screen.getByRole('searchbox', { name: '關鍵字' }), '週會')

  expect(screen.getByRole('searchbox', { name: '關鍵字' })).toHaveValue('週會')
  resolvers.get('週會')?.(entryPage([entry('new-filter', '2026-08-04')]))
  expect(await screen.findByText('記事內容 new-filter')).toBeInTheDocument()
  resolvers.get('週')?.(entryPage([entry('old-filter', '2026-08-03')]))
  await waitFor(() => expect(screen.queryByText('記事內容 old-filter')).not.toBeInTheDocument())
  expect(screen.getByText('記事內容 new-filter')).toBeInTheDocument()
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({
    action: 'listEntries',
    filter: { query: '週會', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 },
  }))
})

test('儲存成功後忽略較舊的列表回應', async () => {
  let resolveList: ((value: EntryListResult) => void) | undefined
  const run = vi.fn().mockImplementation(async (request: { action: string; entry?: EntryInput }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return new Promise((resolve) => {
      resolveList = resolve
    })
    if (request.action === 'saveEntry') return entry('saved', request.entry?.entryDate ?? '2026-08-04', { ...request.entry, id: 'saved' })
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), run }} />)
  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))

  await user.type(screen.getByLabelText('記事內容'), '新記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))
  expect(await screen.findByRole('heading', { name: '新記事' })).toBeInTheDocument()

  resolveList?.(entryPage([entry('old-list', '2026-08-03')]))
  await waitFor(() => expect(screen.queryByText('記事內容 old-list')).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: '新記事' })).toBeInTheDocument()
})

test('刪除成功後忽略較舊的列表回應', async () => {
  const original = entry('delete-me', '2026-08-04')
  let resolveFilteredList: ((value: EntryListResult) => void) | undefined
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries' && request.filter?.categoryId === null) return entryPage([original])
    if (request.action === 'listEntries') return new Promise((resolve) => {
      resolveFilteredList = resolve
    })
    if (request.action === 'deleteEntry') return undefined
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), run }} />)
  await user.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))
  expect(await screen.findByText('記事內容 delete-me')).toBeInTheDocument()

  await user.selectOptions(screen.getByLabelText('分類篩選'), 'work')
  await user.click(within(screen.getByText('記事內容 delete-me').closest('article')!).getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))
  await waitFor(() => expect(screen.queryByText('記事內容 delete-me')).not.toBeInTheDocument())

  resolveFilteredList?.(entryPage([original]))
  await waitFor(() => expect(screen.queryByText('記事內容 delete-me')).not.toBeInTheDocument())
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

function entry(id: string, entryDate: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    entryDate,
    title: `標題 ${id}`,
    content: `記事內容 ${id}`,
    categoryId: 'work',
    tags: ['會議'],
    links: [],
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
    ...overrides,
  }
}

function entryPage(items: Entry[] = [], nextCursor: string | null = null): EntryListResult {
  return { items, nextCursor }
}
