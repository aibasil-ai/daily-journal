// @vitest-environment jsdom

import '../../test/dialog-setup'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from '../../App'
import type { ApiRequest, Entry, EntryFilter, EntryInput, EntryListResult } from '../../domain/journal'
import { SessionEndedError, type JournalClient, useJournal } from './use-journal'
import { AuthenticationError, ExecutionClientError } from '../../services/execution-client'
import { JournalService } from '../../../gas/src/services/journal-service'
import { FakeJournalStore } from '../../../gas/src/test/fake-journal-store'

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
})

afterEach(() => {
  delete window.__JOURNAL_CONFIG__
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

test('缺少部署設定時顯示完整處理指引', async () => {
  vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', { googleClientId: '', gasDeploymentId: '' })

  render(<App />)

  expect(await screen.findByRole('heading', { name: '部署設定有誤' })).toBeInTheDocument()
  expect(screen.getByText('找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_DEPLOYMENT_ID，或建立 public/app-config.js。')).toBeInTheDocument()
})

test('實際 App 無提示授權需要互動時改用同意畫面並載入 bootstrap', async () => {
  let callback: ((response: google.accounts.oauth2.TokenResponse) => void) | undefined
  let bootstrapInit: RequestInit | undefined
  const requestAccessToken = vi.fn(() => {
    callback?.(requestAccessToken.mock.calls.length === 1
      ? { error: 'interaction_required' }
      : { access_token: 'access-token', expires_in: 3600 })
  })
  const initTokenClient = vi.fn((tokenConfig: google.accounts.oauth2.TokenClientConfig) => {
    callback = tokenConfig.callback
    return { requestAccessToken }
  })
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body))
    const request = requestBody.parameters[0] as { action: string }
    if (request.action === 'bootstrap') bootstrapInit = init
    const data = request.action === 'bootstrap'
      ? { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      : entryPage()
    return new Response(JSON.stringify({ response: { result: { ok: true, data } } }))
  })
  vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', { googleClientId: 'client-id', gasDeploymentId: 'deployment-id' })
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } })
  vi.stubGlobal('fetch', fetch)
  const user = userEvent.setup()

  render(<App />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
  expect(requestAccessToken).toHaveBeenNthCalledWith(1, { prompt: '' })
  expect(requestAccessToken).toHaveBeenNthCalledWith(2, { prompt: 'consent' })
  expect(requestAccessToken).toHaveBeenCalledTimes(2)
  expect(bootstrapInit?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token' }))
  expect(JSON.parse(String(bootstrapInit?.body))).toEqual({
    function: 'executeAppRequest',
    parameters: [{ action: 'bootstrap' }],
  })
})

test('登入後載入啟用分類並進入首頁', async () => {
  const calls: string[] = []
  const client = {
    signIn: vi.fn().mockImplementation(async () => {
      calls.push('signIn')
    }),
    signOut: vi.fn(),
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

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '每日記事' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '繼續使用 Google' })).not.toBeInTheDocument()
  expect(calls).toEqual(['signIn', 'run', 'run'])
})

test('登入後顯示登出按鈕，按下後回到連線畫面', async () => {
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage()
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await screen.findByText('已連線至 Google Sheets。')

  await user.click(screen.getByRole('button', { name: '登出' }))

  expect(client.signOut).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '繼續使用 Google' })).toBeInTheDocument()
  expect(screen.queryByText('已連線至 Google Sheets。')).not.toBeInTheDocument()
})

test('App 登出後重新登入不復原選取月份、編輯中記事或匯出錯誤', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')
  const editableEntry = entry('editable', '2026-08-05', { title: '原始標題' })
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage([editableEntry])
      if (request.action === 'getMonthlyEntryCounts') return []
      if (request.action === 'exportEntries') throw new Error('匯出資料失敗')
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  const initialMonth = (await screen.findByRole('heading', { name: /^\d{4}-\d{2} 月曆$/ })).textContent
  await user.click(screen.getByRole('button', { name: '下個月' }))
  expect(screen.getByRole('heading', { name: /^\d{4}-\d{2} 月曆$/ }).textContent).not.toBe(initialMonth)

  const entryCard = (await screen.findByText('記事內容 editable')).closest('article')!
  await user.click(within(entryCard).getByRole('button', { name: '編輯記事' }))
  await user.clear(screen.getByLabelText('標題（選填）'))
  await user.type(screen.getByLabelText('標題（選填）'), '尚未儲存的編輯')
  expect(screen.getByRole('heading', { name: '編輯記事' })).toBeInTheDocument()
  expect(screen.getByLabelText('標題（選填）')).toHaveValue('尚未儲存的編輯')

  await user.click(screen.getByRole('button', { name: '匯出全部記事' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('匯出資料失敗')

  await user.click(screen.getByRole('button', { name: '登出' }))
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByRole('heading', { name: initialMonth! })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '新增記事' })).toBeInTheDocument()
  expect(screen.getByLabelText('標題（選填）')).toHaveValue('')
  expect(screen.queryByRole('button', { name: '取消編輯' })).not.toBeInTheDocument()
  expect(screen.queryByText('匯出資料失敗')).not.toBeInTheDocument()
  expect(client.signIn).toHaveBeenCalledTimes(2)
})

test('登入授權完成前不呼叫 bootstrap', async () => {
  let resolveSignIn: (() => void) | undefined
  const client = {
    signIn: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSignIn = resolve
    })),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => (
      request.action === 'listEntries'
        ? entryPage()
        : { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    )),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(client.signIn).toHaveBeenCalledOnce()
  expect(client.run).not.toHaveBeenCalled()

  resolveSignIn?.()

  await waitFor(() => expect(client.run).toHaveBeenCalledWith({ action: 'bootstrap' }))
})

test('JournalClient 在 TypeScript 層要求 signIn', () => {
  // @ts-expect-error JournalClient must reject a client that cannot authorize bootstrap.
  const missingSignIn: JournalClient = {
    signOut: vi.fn(),
    run: async <T,>() => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }) as T,
  }

  expect(missingSignIn).toBeDefined()
})

test('JournalClient 在 TypeScript 層要求 signOut', () => {
  // @ts-expect-error JournalClient must clear authorization state when a session ends.
  const missingSignOut: JournalClient = {
    signIn: async () => {},
    run: async <T,>() => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }) as T,
  }

  expect(missingSignOut).toBeDefined()
})

test('登出時立即清除已載入的記事並切回未登入狀態', async () => {
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage([entry('loaded', '2026-08-05')])
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<JournalTestHarness client={client} />)

  await user.click(screen.getByRole('button', { name: '登入' }))
  expect(await screen.findByText('記事內容 loaded')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '登出' }))

  expect(client.signOut).toHaveBeenCalledOnce()
  expect(screen.getByText('狀態：signed-out')).toBeInTheDocument()
  expect(screen.queryByText('記事內容 loaded')).not.toBeInTheDocument()
})

test('登出後忽略尚未完成的列表回應', async () => {
  const pendingList = deferred<EntryListResult>()
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return pendingList.promise
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<JournalTestHarness client={client} />)

  await user.click(screen.getByRole('button', { name: '登入' }))
  await screen.findByText('狀態：ready')
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingList.resolve(entryPage([entry('stale', '2026-08-05')])))

  expect(screen.getByText('狀態：signed-out')).toBeInTheDocument()
  expect(screen.queryByText('記事內容 stale')).not.toBeInTheDocument()
})

test('登出後以 SessionEndedError 隔離尚未完成的匯出回應', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const exportErrors = vi.fn()
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage()
      if (request.action === 'exportEntries') return pendingExport.promise
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<JournalTestHarness client={client} onExportError={exportErrors} />)

  await user.click(screen.getByRole('button', { name: '登入' }))
  await screen.findByText('狀態：ready')
  await user.click(screen.getByRole('button', { name: '匯出' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'exportEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.resolve({ headers: ['標題'], rows: [['過期記事']] }))

  await waitFor(() => expect(exportErrors).toHaveBeenCalledWith(expect.any(SessionEndedError)))
})

test('登出後以 SessionEndedError 隔離尚未完成的匯出拒絕', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const exportErrors = vi.fn()
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage()
      if (request.action === 'exportEntries') return pendingExport.promise
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<JournalTestHarness client={client} onExportError={exportErrors} />)

  await user.click(screen.getByRole('button', { name: '登入' }))
  await screen.findByText('狀態：ready')
  await user.click(screen.getByRole('button', { name: '匯出' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'exportEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.reject(new Error('過期匯出失敗')))

  await waitFor(() => expect(exportErrors).toHaveBeenCalledWith(expect.any(SessionEndedError)))
})

test('登入取消時顯示重新登入指引', async () => {
  const client = {
    signIn: vi.fn().mockRejectedValue(new Error('Google 登入或授權未完成。')),
    signOut: vi.fn(),
    run: vi.fn(),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('Google 登入或授權未完成。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
  expect(client.run).not.toHaveBeenCalled()
})

test('GAS 權限錯誤顯示重新登入指引', async () => {
  const client = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run: vi.fn().mockRejectedValue(new AuthenticationError()) }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('登入已過期或沒有 GAS 使用權限，請重新登入。')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '連線至每日記事' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
})

test('網路錯誤顯示可重新嘗試的指引', async () => {
  const client = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run: vi.fn()
    .mockRejectedValueOnce(new ExecutionClientError())
    .mockResolvedValueOnce({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] })
    .mockResolvedValueOnce(entryPage()) }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('暫時無法連線至服務，請稍後再試。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '重新嘗試' }))

  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
})

test('GIS SDK 未載入時顯示重新登入與重新嘗試指引', async () => {
  vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', { googleClientId: 'client-id', gasDeploymentId: 'deployment-id' })
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('Google 登入服務尚未載入。請確認網路連線後重新整理頁面，再重新登入。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新嘗試' })).toBeInTheDocument()
})

test('連線中停用登入按鈕並顯示連線狀態', async () => {
  let resolveBootstrap: ((value: { timezone: string; categories: ReturnType<typeof category>[]; tagSuggestions: string[] }) => void) | undefined
  const client = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveBootstrap = resolve
    })),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(screen.getByRole('button', { name: '連線中...' })).toBeDisabled()
  resolveBootstrap?.({ timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] })
  expect(await screen.findByText('已連線至 Google Sheets。')).toBeInTheDocument()
})

test('連線後載入、儲存、追加與刪除時間軸記事', async () => {
  const first = entry('first', '2026-08-04')
  const second = entry('second', '2026-08-03')
  let saved: Entry | undefined
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter; entry?: EntryInput; id?: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: ['會議'] }
    if (request.action === 'listEntries' && request.filter?.cursor === null) return entryPage(saved ? [saved, first] : [first], saved ? null : 'page-2')
    if (request.action === 'listEntries' && request.filter?.cursor === 'page-2') return entryPage([second])
    if (request.action === 'saveEntry') {
      saved = entry('saved', request.entry?.entryDate ?? '2026-08-04', { ...request.entry, id: 'saved' })
      return saved
    }
    if (request.action === 'deleteEntry') return undefined
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

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

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
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
  const initialList = deferred<EntryListResult>()
  const refreshedList = deferred<EntryListResult>()
  let listCallCount = 0
  const run = vi.fn().mockImplementation(async (request: { action: string; entry?: EntryInput }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return listCallCount++ === 0 ? initialList.promise : refreshedList.promise
    if (request.action === 'saveEntry') return entry('saved', request.entry?.entryDate ?? '2026-08-04', { ...request.entry, id: 'saved' })
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))

  await user.type(screen.getByLabelText('記事內容'), '新記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await act(async () => {
    initialList.resolve(entryPage([entry('old-list', '2026-08-03')]))
    refreshedList.resolve(entryPage([entry('saved', '2026-08-04', { title: '', content: '新記事' })]))
  })

  expect(await screen.findByRole('heading', { name: '新記事' })).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('記事內容 old-list')).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: '新記事' })).toBeInTheDocument()
})

test('儲存後重新載入目前篩選，排除不符合條件的新記事', async () => {
  const matching = entry('matching', '2026-08-04', { title: '符合篩選的標題', content: '僅保留的歷史記事' })
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter; entry?: EntryInput }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage(request.filter?.query === '僅保留' ? [matching] : [matching])
    if (request.action === 'saveEntry') return entry('saved', request.entry?.entryDate ?? '2026-08-04', { ...request.entry, id: 'saved' })
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await user.type(await screen.findByRole('searchbox', { name: '關鍵字' }), '僅保留')
  expect(await screen.findByText('僅保留的歷史記事')).toBeInTheDocument()

  await user.type(screen.getByLabelText('記事內容'), '排除的新記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(run).toHaveBeenCalledWith({
    action: 'listEntries',
    filter: { query: '僅保留', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 },
  }))
  expect(screen.queryByRole('heading', { name: '排除的新記事' })).not.toBeInTheDocument()
  expect(screen.getByText('僅保留的歷史記事')).toBeInTheDocument()
})

test('變更記事日期後以後端排序重新排列目前清單', async () => {
  const older = entry('older', '2026-08-03', { title: '待調整日期' })
  const newer = entry('newer', '2026-08-04', { title: '原本較新' })
  const reordered = entry('older', '2026-08-05', { title: '待調整日期' })
  let saved = false
  const run = vi.fn().mockImplementation(async (request: { action: string; entry?: EntryInput }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage(saved ? [reordered, newer] : [newer, older])
    if (request.action === 'saveEntry') {
      saved = true
      return reordered
    }
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  const olderCard = (await screen.findByRole('heading', { name: '待調整日期' })).closest('article')!
  await user.click(within(olderCard).getByRole('button', { name: '編輯記事' }))
  fireEvent.change(screen.getByLabelText('記錄日期'), { target: { value: '2026-08-05' } })
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })
    .filter((heading) => heading.closest('article'))
    .map((heading) => heading.textContent)).toEqual(['待調整日期', '原本較新']))
})

test('變更記事日期而不再符合篩選時從清單移除', async () => {
  const current = entry('filtered', '2026-08-04', { title: '篩選中的記事' })
  let saved = false
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage(saved && request.filter?.from === '2026-08-04' ? [] : [current])
    if (request.action === 'saveEntry') {
      saved = true
      return entry('filtered', '2026-08-03', { title: '篩選中的記事' })
    }
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  fireEvent.change(await screen.findByLabelText('起始日期'), { target: { value: '2026-08-04' } })
  const card = (await screen.findByRole('heading', { name: '篩選中的記事' })).closest('article')!
  await user.click(within(card).getByRole('button', { name: '編輯記事' }))
  fireEvent.change(screen.getByLabelText('記錄日期'), { target: { value: '2026-08-03' } })
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(screen.queryByRole('heading', { name: '篩選中的記事' })).not.toBeInTheDocument())
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

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  expect(await screen.findByText('記事內容 delete-me')).toBeInTheDocument()

  await user.selectOptions(screen.getByLabelText('分類篩選'), 'work')
  await user.click(within(screen.getByText('記事內容 delete-me').closest('article')!).getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))
  await waitFor(() => expect(screen.queryByText('記事內容 delete-me')).not.toBeInTheDocument())

  resolveFilteredList?.(entryPage([original]))
  await waitFor(() => expect(screen.queryByText('記事內容 delete-me')).not.toBeInTheDocument())
})

test('月曆檢視切換月份只載入數量，選日以目前篩選取得時間軸資料', async () => {
  const run = vi.fn().mockImplementation(async (request: { action: string; filter?: EntryFilter; year?: number; month?: number; date?: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'getMonthlyEntryCounts') {
      const date = `${request.year}-${String(request.month).padStart(2, '0')}-04`
      return [{ date, count: 2 }]
    }
    if (request.action === 'getEntriesForDate') return [entry('selected', request.date ?? '2026-08-04')]
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')
  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getMonthlyEntryCounts' })))

  const monthlyRequest = run.mock.calls.map(([request]) => request).find((request) => request.action === 'getMonthlyEntryCounts') as { year: number; month: number }
  const selectedDate = `${monthlyRequest.year}-${String(monthlyRequest.month).padStart(2, '0')}-04`
  await user.type(screen.getByRole('searchbox', { name: '關鍵字' }), '規劃')
  await waitFor(() => expect(run).toHaveBeenCalledWith({
    action: 'getMonthlyEntryCounts',
    year: monthlyRequest.year,
    month: monthlyRequest.month,
    filter: { query: '規劃', from: null, to: null, categoryId: null, tag: null },
  }))

  await user.click(await screen.findByRole('button', { name: `${selectedDate}，共 2 則記事` }))

  await waitFor(() => expect(run).toHaveBeenCalledWith({
    action: 'getEntriesForDate',
    date: selectedDate,
    filter: { query: '規劃', from: null, to: null, categoryId: null, tag: null },
  }))
  expect(await screen.findByText('記事內容 selected')).toBeInTheDocument()

  const listRequestCount = run.mock.calls.filter(([request]) => request.action === 'listEntries').length
  await user.click(screen.getByRole('button', { name: '下個月' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getMonthlyEntryCounts', month: monthlyRequest.month === 12 ? 1 : monthlyRequest.month + 1 })))
  expect(run.mock.calls.filter(([request]) => request.action === 'listEntries')).toHaveLength(listRequestCount)
})

test('新增、變更日期與刪除記事後重新取得月曆數量並忽略舊回應', async () => {
  const staleCounts = deferred<{ date: string; count: number }[]>()
  let requestedMonth = ''
  let monthlyRequestCount = 0
  let saved: Entry | undefined
  const run = vi.fn().mockImplementation(async (request: { action: string; entry?: EntryInput; year?: number; month?: number }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage(saved ? [saved] : [])
    if (request.action === 'getMonthlyEntryCounts') {
      requestedMonth = `${request.year}-${String(request.month).padStart(2, '0')}`
      monthlyRequestCount += 1
      if (monthlyRequestCount === 1) return staleCounts.promise
      if (monthlyRequestCount === 2) return [{ date: `${requestedMonth}-10`, count: 1 }]
      if (monthlyRequestCount === 3) return [{ date: `${requestedMonth}-11`, count: 1 }]
      return []
    }
    if (request.action === 'saveEntry') {
      saved = entry('saved', request.entry?.entryDate ?? `${requestedMonth}-10`, { ...request.entry, id: 'saved' })
      return saved
    }
    if (request.action === 'deleteEntry') {
      saved = undefined
      return undefined
    }
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')
  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await waitFor(() => expect(monthlyRequestCount).toBe(1))

  const originalDate = `${requestedMonth}-10`
  const movedDate = `${requestedMonth}-11`
  fireEvent.change(screen.getByLabelText('記錄日期'), { target: { value: originalDate } })
  await user.type(screen.getByLabelText('記事內容'), '待同步記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(monthlyRequestCount).toBe(2))
  expect(await screen.findByRole('button', { name: `${originalDate}，共 1 則記事` })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '編輯記事' }))
  fireEvent.change(screen.getByLabelText('記錄日期'), { target: { value: movedDate } })
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(monthlyRequestCount).toBe(3))
  expect(await screen.findByRole('button', { name: `${originalDate}，共 0 則記事` })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: `${movedDate}，共 1 則記事` })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  await waitFor(() => expect(monthlyRequestCount).toBe(4))
  expect(await screen.findByRole('button', { name: `${movedDate}，共 0 則記事` })).toBeInTheDocument()

  await act(async () => {
    staleCounts.resolve([{ date: originalDate, count: 99 }])
  })

  expect(screen.getByRole('button', { name: `${originalDate}，共 0 則記事` })).toBeInTheDocument()
})

test('選日結果不被較舊的清單回應覆寫', async () => {
  const listResponse = deferred<EntryListResult>()
  const selectedResponse = deferred<Entry[]>()
  let selectedDate = ''
  const run = vi.fn().mockImplementation(async (request: { action: string; year?: number; month?: number; date?: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return listResponse.promise
    if (request.action === 'getMonthlyEntryCounts') {
      selectedDate = `${request.year}-${String(request.month).padStart(2, '0')}-04`
      return [{ date: selectedDate, count: 1 }]
    }
    if (request.action === 'getEntriesForDate') return selectedResponse.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')
  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'listEntries' })))
  await user.click(await screen.findByRole('button', { name: `${selectedDate}，共 1 則記事` }))

  await act(async () => {
    selectedResponse.resolve([entry('selected-date', selectedDate)])
  })
  expect(await screen.findByText('記事內容 selected-date')).toBeInTheDocument()

  await act(async () => {
    listResponse.resolve(entryPage([entry('old-list', selectedDate)]))
  })

  expect(screen.getByText('記事內容 selected-date')).toBeInTheDocument()
  expect(screen.queryByText('記事內容 old-list')).not.toBeInTheDocument()
})

test('檢視切換按鈕更新 aria-pressed 並保存使用者偏好', async () => {
  const user = userEvent.setup()
  const run = vi.fn().mockImplementation(async (request: { action: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'getMonthlyEntryCounts') return []
    throw new Error('未預期的請求')
  })

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  window.localStorage.setItem('daily-journal:view', 'calendar')
  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByRole('button', { name: '月曆' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '時間軸' }))

  expect(screen.getByRole('button', { name: '時間軸' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '月曆' })).toHaveAttribute('aria-pressed', 'false')
  expect(window.localStorage.getItem('daily-journal:view')).toBe('timeline')
})

test('新增與停用分類後同步管理清單及可選分類', async () => {
  const run = vi.fn().mockImplementation(async (request: { action: string; category?: { id?: string; name: string }; id?: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work', true)], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'saveCategory') return category('life', true, request.category?.name ?? '生活')
    if (request.action === 'deactivateCategory') return category(request.id ?? 'work', false)
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  await user.type(await screen.findByLabelText('新增分類名稱'), '生活')
  await user.click(screen.getByRole('button', { name: '新增分類' }))
  await waitFor(() => expect(screen.getAllByRole('option', { name: '生活' })).toHaveLength(2))

  await user.click(screen.getByRole('button', { name: '停用 work' }))
  await user.click(screen.getByRole('button', { name: '確認停用' }))

  expect(await screen.findByText('已停用')).toBeInTheDocument()
  expect(screen.queryAllByRole('option', { name: 'work' })).toHaveLength(0)
  expect(run).toHaveBeenCalledWith({ action: 'saveCategory', category: { name: '生活' } })
  expect(run).toHaveBeenCalledWith({ action: 'deactivateCategory', id: 'work' })
  expect(run).toHaveBeenCalledWith({
    action: 'listEntries',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 },
  })
})

test('重新登入後 bootstrap 保留已停用分類於管理清單但不提供選用', async () => {
  const service = new JournalService(new FakeJournalStore({ categories: [category('work'), category('old')] }), () => '2026-08-04T00:00:00+08:00', () => 'uuid')
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: async <T,>(request: ApiRequest) => {
      if (request.action === 'bootstrap') return service.bootstrap() as T
      if (request.action === 'listEntries') return entryPage() as T
      throw new Error('未預期的請求')
    },
  }
  const user = userEvent.setup()
  const { unmount } = render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  expect(screen.queryByText('已停用')).not.toBeInTheDocument()
  service.deactivateCategory('old')
  unmount()

  render(<App client={client} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))

  expect(await screen.findByText('已停用')).toBeInTheDocument()
  expect(screen.getByText('old')).toBeInTheDocument()
  expect(screen.queryAllByRole('option', { name: 'old' })).toHaveLength(0)
})

test('以目前篩選條件或全部記事匯出 CSV', async () => {
  const createObjectURL = vi.fn(() => 'blob:csv')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const run = vi.fn().mockImplementation(async (request: { action: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return { headers: ['標題'], rows: [['記事']] }
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await user.type(await screen.findByRole('searchbox', { name: '關鍵字' }), '週會')

  await user.click(screen.getByRole('button', { name: '匯出目前篩選結果' }))
  await user.click(screen.getByRole('button', { name: '匯出全部記事' }))

  await waitFor(() => expect(run).toHaveBeenCalledWith({
    action: 'exportEntries',
    filter: { query: '週會', from: null, to: null, categoryId: null, tag: null },
  }))
  expect(run).toHaveBeenCalledWith({
    action: 'exportEntries',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  })
  expect(createObjectURL).toHaveBeenCalledTimes(2)
  expect(revokeObjectURL).toHaveBeenCalledTimes(2)
})

test('匯出進行中停用兩個按鈕，失敗時顯示後端文案', async () => {
  const exportResult = deferred<{ headers: string[]; rows: string[][] }>()
  const run = vi.fn().mockImplementation(async (request: { action: string }) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
    if (request.action === 'listEntries') return entryPage()
    if (request.action === 'exportEntries') return exportResult.promise
    throw new Error('未預期的請求')
  })
  const user = userEvent.setup()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  render(<App client={{ signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(), run }} />)
  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  const filteredButton = await screen.findByRole('button', { name: '匯出目前篩選結果' })
  await user.click(filteredButton)

  expect(filteredButton).toBeDisabled()
  expect(screen.getByRole('button', { name: '匯出全部記事' })).toBeDisabled()
  expect(run.mock.calls.filter(([request]) => request.action === 'exportEntries')).toHaveLength(1)

  exportResult.resolve({ headers: ['標題'], rows: [['記事']] })
  await waitFor(() => expect(filteredButton).not.toBeDisabled())

  run.mockImplementation(async (request: { action: string }) => {
    if (request.action === 'exportEntries') throw new Error('匯出資料失敗')
    if (request.action === 'listEntries') return entryPage()
    return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
  })
  await user.click(filteredButton)

  expect(await screen.findByRole('alert')).toHaveTextContent('匯出資料失敗')
})

test('正式 App 登出後不下載過期的成功匯出', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const createObjectURL = vi.fn(() => 'blob:csv')
  const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadClick.mockClear()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage()
      if (request.action === 'exportEntries') return pendingExport.promise
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await user.click(await screen.findByRole('button', { name: '匯出全部記事' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'exportEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.resolve({ headers: ['標題'], rows: [['過期記事']] }))

  expect(screen.getByRole('button', { name: '繼續使用 Google' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(downloadClick).not.toHaveBeenCalled()
})

test('正式 App 登出後不顯示過期的匯出失敗', async () => {
  const pendingExport = deferred<{ headers: string[]; rows: string[][] }>()
  const createObjectURL = vi.fn(() => 'blob:csv')
  const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadClick.mockClear()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  const client: JournalClient = {
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    run: vi.fn().mockImplementation(async (request: { action: string }) => {
      if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category('work')], tagSuggestions: [] }
      if (request.action === 'listEntries') return entryPage()
      if (request.action === 'exportEntries') return pendingExport.promise
      throw new Error('未預期的請求')
    }),
  }
  const user = userEvent.setup()
  render(<App client={client} />)

  await user.click(await screen.findByRole('button', { name: '繼續使用 Google' }))
  await user.click(await screen.findByRole('button', { name: '匯出全部記事' }))
  await waitFor(() => expect(client.run).toHaveBeenCalledWith(expect.objectContaining({ action: 'exportEntries' })))

  await user.click(screen.getByRole('button', { name: '登出' }))
  await act(async () => pendingExport.reject(new Error('過期匯出失敗')))

  expect(screen.getByRole('button', { name: '繼續使用 Google' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(createObjectURL).not.toHaveBeenCalled()
  expect(downloadClick).not.toHaveBeenCalled()
})

function category(id: string, isActive = true, name = id) {
  return {
    id,
    name,
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

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function JournalTestHarness({ client, onExportError }: { client: JournalClient; onExportError?: (error: unknown) => void }) {
  const journal = useJournal(client)

  return (
    <>
      <p>狀態：{journal.status}</p>
      {journal.entries.map((currentEntry) => <p key={currentEntry.id}>{currentEntry.content}</p>)}
      <button type="button" onClick={() => void journal.signIn()}>登入</button>
      <button type="button" onClick={journal.signOut}>登出</button>
      <button
        type="button"
        onClick={() => {
          void journal.exportEntries('all').catch(onExportError)
        }}
      >
        匯出
      </button>
    </>
  )
}
