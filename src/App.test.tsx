import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiRequest, DailyEntries, Entry } from './domain/journal'
import { App } from './App'
import type { JournalClient } from './features/journal/use-journal'
import { zhTW } from './i18n/zh-TW'
import {
  AuthenticationError,
  type AccountClient,
  type ProvisioningClient,
} from './services/journal-api-client'
import { getJournalMonth } from './utils/date'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('恢復有效 session 後載入啟用分類並進入首頁', async () => {
  const user = userEvent.setup()
  const categories = [{
    id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }]
  const run = vi.fn(async (request: ApiRequest) => {
      if (request.action === 'bootstrap') {
        return {
          timezone: 'Asia/Taipei',
          categories,
          tagSuggestions: [],
        }
      }
      if (request.action === 'listEntries') return { items: [], nextCursor: null }
      if (request.action === 'listCategories') return { categories, entryCounts: { work: 3 } }
      if (request.action === 'getEntriesForRange') return []
      throw new Error(`未預期的請求：${request.action}`)
    })
  const client = createClient({ run: run as JournalClient['run'] })

  render(<App client={client} />)

  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'bootstrap' }))
  expect(await screen.findByRole('heading', { name: '每日記事' })).toBeInTheDocument()
  expect(run).toHaveBeenCalledWith({ action: 'bootstrap' })
  await user.click(screen.getAllByRole('button', { name: '類別管理' })[0])
  expect(await screen.findByText('3 則記事')).toBeInTheDocument()
})

test('GAS 省略空白分頁游標時仍可儲存記事', async () => {
  const user = userEvent.setup()
  const category = {
    id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }
  const savedEntry = {
    id: 'entry-1', entryDate: '2026-08-04', title: '', content: '完成測試', categoryId: 'work', tags: [], links: [],
    createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') {
      return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 0 } }
    if (request.action === 'listEntries') return { items: [savedEntry] }
    if (request.action === 'getEntriesForRange') return []
    if (request.action === 'saveEntry') return savedEntry
    throw new Error(`未預期的請求：${request.action}`)
  })

  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  await screen.findByRole('heading', { name: '每日記事' })
  await user.click(screen.getAllByRole('button', { name: '新增記事' })[0])
  await user.type(screen.getByLabelText('記事內容'), savedEntry.content)
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'saveEntry' }))
})

test('登入按鈕只啟動伺服器端 OAuth 流程', async () => {
  const beginSignIn = vi.fn()
  const run = vi.fn()
  render(<App client={createClient({
    restoreSession: async () => 'signed-out',
    beginSignIn,
    run: run as JournalClient['run'],
  })} />)

  await userEvent.click(await screen.findByRole('button', { name: '使用 Google 帳號登入' }))

  expect(beginSignIn).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
})

test('登出立即清除畫面並呼叫 server session 登出', async () => {
  const user = userEvent.setup()
  const signOut = vi.fn(async () => undefined)
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ signOut, run: run as JournalClient['run'] })} />)

  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'bootstrap' }))
  await user.click(screen.getAllByRole('button', { name: '登出' })[0])

  expect(signOut).toHaveBeenCalledOnce()
  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('登出失敗時清除既有資料、顯示可重試錯誤且不假裝已登出', async () => {
  const user = userEvent.setup()
  const entry = {
    id: 'entry-sign-out', entryDate: '2026-08-20', title: '', content: '登出失敗後不得保留', categoryId: 'work', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const category = {
    id: 'work', name: '工作', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const signOut = vi.fn()
    .mockRejectedValueOnce(new Error('logout service failure'))
    .mockResolvedValueOnce(undefined)
  render(<App client={createClient({ signOut, run: run as JournalClient['run'] })} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  await screen.findByRole('button', { name: `閱讀記事：${entry.content}` })
  await user.click(screen.getAllByRole('button', { name: '登出' })[0])

  expect(await screen.findByRole('alert')).toHaveTextContent(zhTW.errors.signOut)
  expect(screen.queryByRole('button', { name: `閱讀記事：${entry.content}` })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重新嘗試' }))

  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('設定工作階段只呈現資料空間設定，且不 bootstrap', async () => {
  const run = vi.fn()
  render(<App client={createClient({
    restoreSession: async () => 'provisioning',
    run: run as JournalClient['run'],
  })} />)

  expect(await screen.findByRole('heading', { name: '設定您的資料空間' })).toBeInTheDocument()
  expect(run).not.toHaveBeenCalled()
})

test('確認更換資料表後，舊資料不會在重新載入前短暫顯示', async () => {
  const user = userEvent.setup()
  const oldEntry = {
    id: 'entry-old', entryDate: '2026-08-20', title: '', content: '舊資料不得顯示', categoryId: 'old', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const newEntry = {
    id: 'entry-new', entryDate: '2026-08-20', title: '', content: '新的資料空間', categoryId: 'new', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const oldCategory = {
    id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const newCategory = {
    id: 'new', name: '新分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  let changed = false
  type NewBootstrap = { timezone: string; categories: typeof newCategory[]; tagSuggestions: string[] }
  let resolveNewBootstrap: ((value: NewBootstrap) => void) | undefined
  const newBootstrap = new Promise<NewBootstrap>((resolve) => {
    resolveNewBootstrap = resolve
  })
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') {
      return changed
        ? newBootstrap
        : { timezone: 'Asia/Taipei', categories: [oldCategory], tagSuggestions: ['舊標籤'] }
    }
    if (request.action === 'listCategories') {
      return changed
        ? { categories: [newCategory], entryCounts: { new: 1 } }
        : { categories: [oldCategory], entryCounts: { old: 1 } }
    }
    if (request.action === 'listEntries') {
      return { items: changed ? [newEntry] : [oldEntry], nextCursor: null }
    }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({
    run: run as JournalClient['run'],
    getProvisioningStatus: vi.fn(async () => ({
      phase: 'initial_choice' as const,
      sheetName: '目前的每日記事',
      lastUpdatedAt: 1,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    startSheetChange: vi.fn(async () => ({
      phase: 'initial_choice' as const,
      sheetName: '目前的每日記事',
      lastUpdatedAt: 1,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    createSheet: vi.fn(async () => ({
      phase: 'ready_to_confirm' as const,
      sheetName: '新的每日記事',
      lastUpdatedAt: 2,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    confirmProvisioning: vi.fn(async () => {
      changed = true
      return {
        phase: 'completed' as const,
        sheetName: '新的每日記事',
        lastUpdatedAt: 3,
        connectionVersion: 2,
        canDeleteActiveSystemSheet: true,
        errorCode: null,
      }
    }),
  })
  render(<App client={client} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${oldEntry.content}` })).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '資料空間設定' })[0])
  expect(await screen.findByRole('heading', { name: '設定您的資料空間' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '建立「每日記事」' }))
  await user.click(await screen.findByRole('button', { name: '確認更換資料表' }))

  await waitFor(() => expect(client.restoreSession).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: `閱讀記事：${oldEntry.content}` })).not.toBeInTheDocument()

  resolveNewBootstrap?.({ timezone: 'Asia/Taipei', categories: [newCategory], tagSuggestions: ['新標籤'] })
  expect(await screen.findByRole('button', { name: `閱讀記事：${newEntry.content}` })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: `閱讀記事：${oldEntry.content}` })).not.toBeInTheDocument()
})

test('桌面與行動版導覽都提供設定頁，並以安全 provisioning status 顯示連線資訊', async () => {
  const user = userEvent.setup()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({
    run: run as JournalClient['run'],
    getProvisioningStatus: vi.fn(async () => ({
      phase: 'completed' as const,
      sheetName: '目前的私人記事',
      lastUpdatedAt: 1,
      connectionVersion: 7,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
      spreadsheetId: 'must-not-be-rendered',
    })),
  })
  render(<App client={client} />)

  await screen.findByRole('heading', { name: '每日記事' })
  const settingsButtons = screen.getAllByRole('button', { name: '設定' })
  expect(settingsButtons.length).toBeGreaterThanOrEqual(2)
  await user.click(settingsButtons[0])

  expect(await screen.findByRole('heading', { name: '資料連線與帳號設定' })).toBeInTheDocument()
  expect(await screen.findByText('目前的私人記事')).toBeInTheDocument()
  expect(screen.queryByText('must-not-be-rendered')).not.toBeInTheDocument()
})

test('取消更換資料表後仍保留原本的時間軸資料', async () => {
  const user = userEvent.setup()
  const oldEntry = {
    id: 'entry-old', entryDate: '2026-08-20', title: '', content: '取消後仍保留的舊資料', categoryId: 'old', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const oldCategory = {
    id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const confirmProvisioning = vi.fn(async () => ({
    phase: 'completed' as const,
    sheetName: '新的每日記事',
    lastUpdatedAt: 2,
    connectionVersion: 2,
    canDeleteActiveSystemSheet: true,
    errorCode: null,
  }))
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [oldCategory], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [oldCategory], entryCounts: { old: 1 } }
    if (request.action === 'listEntries') return { items: [oldEntry], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({
    run: run as JournalClient['run'],
    startSheetChange: vi.fn(async () => ({
      phase: 'initial_choice' as const,
      sheetName: '原本的每日記事',
      lastUpdatedAt: 1,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    createSheet: vi.fn(async () => ({
      phase: 'ready_to_confirm' as const,
      sheetName: '新的每日記事',
      lastUpdatedAt: 2,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    confirmProvisioning,
  })} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${oldEntry.content}` })).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '資料空間設定' })[0])
  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))
  await user.click(await screen.findByRole('button', { name: '取消更換' }))

  expect(confirmProvisioning).not.toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: `閱讀記事：${oldEntry.content}` })).toBeInTheDocument()
})

test('取消更換資料表後設定頁恢復既有連線狀態', async () => {
  const user = userEvent.setup()
  const activeStatus = {
    phase: 'completed' as const,
    sheetName: '原本的每日記事',
    lastUpdatedAt: 1,
    connectionVersion: 1,
    canDeleteActiveSystemSheet: false,
    errorCode: null,
  }
  const changingStatus = {
    ...activeStatus,
    phase: 'initial_choice' as const,
  }
  let isChanging = false
  const getProvisioningStatus = vi.fn(async () => isChanging ? changingStatus : activeStatus)
  const cancelSheetChange = vi.fn(async () => {
    isChanging = false
  })
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({
    run: run as JournalClient['run'],
    getProvisioningStatus,
    startSheetChange: vi.fn(async () => {
      isChanging = true
      return changingStatus
    }),
    cancelSheetChange,
  })} />)

  await user.click((await screen.findAllByRole('button', { name: '設定' }))[0])
  expect(await screen.findByText('原本的每日記事')).toBeInTheDocument()
  expect(screen.getByText('已連線')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '更換資料表' }))
  await screen.findByRole('heading', { name: '設定您的資料空間' })
  await user.click(screen.getByRole('button', { name: '取消更換' }))

  await waitFor(() => expect(cancelSheetChange).toHaveBeenCalledOnce())
  expect(await screen.findByRole('heading', { name: '資料連線與帳號設定' })).toBeInTheDocument()
  expect(await screen.findByText('原本的每日記事')).toBeInTheDocument()
  expect(screen.getByText('已連線')).toBeInTheDocument()
  expect(screen.queryByText('等待選擇資料表')).not.toBeInTheDocument()
})

test('中斷連線請求失敗時保留既有記事資料', async () => {
  const user = userEvent.setup()
  const entry = {
    id: 'entry-old', entryDate: '2026-08-20', title: '', content: '中斷失敗後保留的資料', categoryId: 'old', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const category = {
    id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { old: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const disconnect = vi.fn(async () => {
    throw new Error('中斷連線失敗')
  })
  render(<App client={createClient({ run: run as JournalClient['run'], disconnect })} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${entry.content}` })).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '設定' })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: '中斷連線' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '中斷連線' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '中斷連線' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('中斷連線失敗')
  await user.click(screen.getAllByRole('button', { name: '時間軸' })[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${entry.content}` })).toBeInTheDocument()
})

test('中斷連線成功後清除資料並回到未登入畫面', async () => {
  const user = userEvent.setup()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const disconnect = vi.fn(async () => undefined)
  const signOut = vi.fn()
  render(<App client={createClient({ run: run as JournalClient['run'], disconnect, signOut })} />)

  await screen.findByRole('heading', { name: '每日記事' })
  await user.click(screen.getAllByRole('button', { name: '設定' })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: '中斷連線' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '中斷連線' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '中斷連線' }))

  await waitFor(() => expect(disconnect).toHaveBeenCalledOnce())
  expect(signOut).not.toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('刪除帳號成功後清除資料並回到未登入畫面', async () => {
  const user = userEvent.setup()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const deleteAccount = vi.fn(async () => undefined)
  render(<App client={createClient({ run: run as JournalClient['run'], deleteAccount })} />)

  await screen.findByRole('heading', { name: '每日記事' })
  await user.click(screen.getAllByRole('button', { name: '設定' })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: '刪除帳號資料' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '刪除帳號資料' }))
  const dialog = screen.getByRole('dialog', { name: '確認刪除帳號資料' })
  await user.type(screen.getByLabelText('請輸入「刪除我的帳號」確認'), '刪除我的帳號')
  await user.click(within(dialog).getByRole('button', { name: '刪除帳號資料' }))

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith({
    deleteSystemCreatedSheet: false,
    confirmation: '刪除我的帳號',
  }))
  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
})

test('初次設定資料空間認證失效時重新探測 session 並回到登入畫面', async () => {
  const user = userEvent.setup()
  let restoreCount = 0
  const restoreSession = vi.fn(async () => {
    restoreCount += 1
    return restoreCount === 1 ? 'provisioning' as const : 'signed-out' as const
  })
  render(<App client={createClient({
    restoreSession,
    createSheet: vi.fn(async () => {
      throw new AuthenticationError()
    }),
  })} />)

  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))

  expect(await screen.findByRole('button', { name: '使用 Google 帳號登入' })).toBeInTheDocument()
  expect(restoreSession).toHaveBeenCalledTimes(2)
})

test('更換資料表期間認證失效時重新探測並還原原本資料', async () => {
  const user = userEvent.setup()
  const oldEntry = {
    id: 'entry-old', entryDate: '2026-08-20', title: '', content: '原本的資料仍可使用', categoryId: 'old', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const category = {
    id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { old: 1 } }
    if (request.action === 'listEntries') return { items: [oldEntry], nextCursor: null }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({
    run: run as JournalClient['run'],
    startSheetChange: vi.fn(async () => ({
      phase: 'initial_choice' as const,
      sheetName: '原本的資料表',
      lastUpdatedAt: 1,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    createSheet: vi.fn(async () => {
      throw new AuthenticationError()
    }),
  })
  render(<App client={client} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${oldEntry.content}` })).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '資料空間設定' })[0])
  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))

  expect(await screen.findByRole('button', { name: `閱讀記事：${oldEntry.content}` })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).not.toBeInTheDocument()
  expect(client.restoreSession).toHaveBeenCalledTimes(2)
})

test('更換資料表期間忽略舊月曆與日期請求的回應及登入失效', async () => {
  const user = userEvent.setup()
  const oldCalendarEntry = {
    id: 'calendar-old', entryDate: '', title: '', content: '舊月曆資料不得寫回', categoryId: 'old', tags: [], links: [],
    createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const oldTimelineEntry = {
    ...oldCalendarEntry,
    id: 'timeline-old',
    entryDate: '2026-08-20',
    content: '舊資料空間',
  }
  const newEntry = {
    ...oldTimelineEntry,
    id: 'timeline-new',
    categoryId: 'new',
    content: '新資料空間',
  }
  const oldCategory = {
    id: 'old', name: '舊分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const newCategory = {
    id: 'new', name: '新分類', isActive: true, createdAt: '2026-08-20T00:00:00+08:00', updatedAt: '2026-08-20T00:00:00+08:00',
  }
  const oldMonthly = deferred<DailyEntries[]>()
  const oldDateEntries = deferred<DailyEntries[]>()
  let changed = false
  let monthlyRequestCount = 0
  let selectableDate = ''
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') {
      return changed
        ? { timezone: 'Asia/Taipei', categories: [newCategory], tagSuggestions: [] }
        : { timezone: 'Asia/Taipei', categories: [oldCategory], tagSuggestions: [] }
    }
    if (request.action === 'listCategories') {
      return changed
        ? { categories: [newCategory], entryCounts: { new: 1 } }
        : { categories: [oldCategory], entryCounts: { old: 1 } }
    }
    if (request.action === 'listEntries') return { items: changed ? [newEntry] : [oldTimelineEntry], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      if (request.from === request.to) return oldDateEntries.promise
      if (changed) return []
      monthlyRequestCount += 1
      if (monthlyRequestCount === 1) return oldMonthly.promise
      selectableDate = `${request.from.slice(0, 7)}-01`
      return [{ date: selectableDate, entries: [{ ...oldCalendarEntry, entryDate: selectableDate }] }]
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({
    run: run as JournalClient['run'],
    startSheetChange: vi.fn(async () => ({
      phase: 'initial_choice' as const,
      sheetName: '原本的資料表',
      lastUpdatedAt: 1,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    createSheet: vi.fn(async () => ({
      phase: 'ready_to_confirm' as const,
      sheetName: '新的資料表',
      lastUpdatedAt: 2,
      connectionVersion: 1,
      canDeleteActiveSystemSheet: false,
      errorCode: null,
    })),
    confirmProvisioning: vi.fn(async () => {
      changed = true
      return {
        phase: 'completed' as const,
        sheetName: '新的資料表',
        lastUpdatedAt: 3,
        connectionVersion: 2,
        canDeleteActiveSystemSheet: false,
        errorCode: null,
      }
    }),
  })
  render(<App client={client} />)

  await user.click((await screen.findAllByRole('button', { name: '日曆' }))[0])
  await screen.findByRole('heading', { name: '日曆' })
  await waitFor(() => expect(monthlyRequestCount).toBe(1))
  await user.click(screen.getByRole('button', { name: '下一個月' }))
  await waitFor(() => expect(monthlyRequestCount).toBe(2))
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${selectableDate}，共 1 則記事`) }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getEntriesForRange', from: selectableDate, to: selectableDate })))

  await user.click(screen.getAllByRole('button', { name: '資料空間設定' })[0])
  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))
  await user.click(await screen.findByRole('button', { name: '確認更換資料表' }))
  await waitFor(() => expect(client.restoreSession).toHaveBeenCalledTimes(2))

  await act(async () => {
    oldMonthly.resolve([{ date: selectableDate, entries: [{ ...oldCalendarEntry, entryDate: selectableDate }] }])
    oldDateEntries.reject(new AuthenticationError())
    await Promise.resolve()
  })

  expect(screen.queryByRole('button', { name: `閱讀記事：${oldCalendarEntry.content}` })).not.toBeInTheDocument()
  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  expect(await screen.findByRole('button', { name: `閱讀記事：${newEntry.content}` })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).not.toBeInTheDocument()
})

test('視窗重新取得焦點時只重新探測一次 session', async () => {
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const restoreSession = vi.fn(async () => 'authenticated' as const)
  render(<App client={createClient({ restoreSession, run: run as JournalClient['run'] })} />)

  await screen.findByRole('heading', { name: '每日記事' })
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('focus'))

  await waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(2))
})

test('曾登入的使用者重新整理時顯示淺色載入畫面，不閃爍登入頁面', async () => {
  window.localStorage.setItem('daily-journal-auth-hint', '1')
  const sessionDeferred = deferred<'authenticated'>()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({
    restoreSession: vi.fn(() => sessionDeferred.promise),
    run: run as JournalClient['run'],
  })

  render(<App client={client} />)

  expect(screen.getByText('連線中...')).toBeInTheDocument()
  expect(screen.queryByText('把今天，寫進時光裡')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).not.toBeInTheDocument()

  act(() => {
    sessionDeferred.resolve('authenticated')
  })

  expect(await screen.findByRole('heading', { name: '每日記事' })).toBeInTheDocument()
})

test('預設隱藏搜尋與篩選區塊，點擊按鈕後展開與收合', async () => {
  const user = userEvent.setup()
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })
  const client = createClient({ run: run as JournalClient['run'] })

  render(<App client={client} />)

  await screen.findByRole('heading', { name: '每日記事' })
  expect(screen.queryByPlaceholderText('搜尋記事...')).not.toBeInTheDocument()

  const toggleBtn = screen.getAllByRole('button', { name: '開啟搜尋與篩選' })[0]
  await user.click(toggleBtn)

  expect(screen.getByPlaceholderText('搜尋記事...')).toBeInTheDocument()

  await user.click(screen.getAllByRole('button', { name: '收合搜尋與篩選' })[0])
  expect(screen.queryByPlaceholderText('搜尋記事...')).not.toBeInTheDocument()
})

test('點選記事進入詳情後返回月曆，能恢復原本的滾軸位置', async () => {
  const user = userEvent.setup()
  const testMonth = getJournalMonth('Asia/Taipei')
  const testDate = `${testMonth}-04`
  const entry = {
    id: 'entry-scroll-1', entryDate: testDate, title: '測試記事', content: '內容', categoryId: 'work', tags: [], links: [],
    createdAt: `${testDate}T00:00:00+08:00`, updatedAt: `${testDate}T00:00:00+08:00`,
  }
  const category = {
    id: 'work', name: '工作', isActive: true, createdAt: `${testDate}T00:00:00+08:00`, updatedAt: `${testDate}T00:00:00+08:00`,
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getEntriesForRange') return [{ date: testDate, entries: [entry] }]
    throw new Error(`未預期的請求：${request.action}`)
  })
  const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = createClient({ run: run as JournalClient['run'] })

  render(<App client={client} />)
  await screen.findByRole('heading', { name: '每日記事' })

  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  expect(await screen.findByText('測試記事')).toBeInTheDocument()

  Object.defineProperty(window, 'scrollY', { value: 350, writable: true, configurable: true })

  await user.click(screen.getByRole('button', { name: '閱讀記事：測試記事' }))
  expect(await screen.findByRole('heading', { level: 1, name: '測試記事' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '返回日曆' }))
  expect(await screen.findByText('測試記事')).toBeInTheDocument()

  expect(scrollToSpy).toHaveBeenCalledWith(0, 350)
  scrollToSpy.mockRestore()
})

test('點選特定日期查看記事列表後返回月曆，能恢復原本的滾軸位置', async () => {
  const user = userEvent.setup()
  const testMonth = getJournalMonth('Asia/Taipei')
  const testDate = `${testMonth}-04`
  const [year, monthNumber] = testMonth.split('-').map(Number)
  const entry = {
    id: 'entry-scroll-date-1', entryDate: testDate, title: '特定日期記事', content: '內容', categoryId: 'work', tags: [], links: [],
    createdAt: `${testDate}T00:00:00+08:00`, updatedAt: `${testDate}T00:00:00+08:00`,
  }
  const category = {
    id: 'work', name: '工作', isActive: true, createdAt: `${testDate}T00:00:00+08:00`, updatedAt: `${testDate}T00:00:00+08:00`,
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getEntriesForRange') return [{ date: testDate, entries: [entry] }]
    throw new Error(`未預期的請求：${request.action}`)
  })
  const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const client = createClient({ run: run as JournalClient['run'] })

  render(<App client={client} />)
  await screen.findByRole('heading', { name: '每日記事' })

  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  expect(await screen.findByText('特定日期記事')).toBeInTheDocument()

  // Simulate user scrolled down to 420px on the calendar
  Object.defineProperty(window, 'scrollY', { value: 420, writable: true, configurable: true })

  // Click on the date button (e.g. "4")
  await user.click(screen.getByRole('button', { name: `${testDate}，共 1 則記事` }))
  expect(await screen.findByRole('heading', { level: 2, name: `${testDate} 的記事` })).toBeInTheDocument()

  // Click "返回日曆" on the date selection view
  await user.click(screen.getByRole('button', { name: '返回日曆' }))
  expect(await screen.findByRole('grid', { name: `${year}年${monthNumber}月` })).toBeInTheDocument()

  // Verify scroll position was restored to 420
  expect(scrollToSpy).toHaveBeenCalledWith(0, 420)
  scrollToSpy.mockRestore()
})

test('記事詳情依原主頁顯示返回時間軸或日曆', async () => {
  const user = userEvent.setup()
  const entryDate = `${getJournalMonth('Asia/Taipei')}-03`
  const entry = {
    id: 'entry-source', entryDate, title: '來源測試', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: `${entryDate}T09:00:00+08:00`, updatedAt: `${entryDate}T09:00:00+08:00`,
  }
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-03T00:00:00+08:00', updatedAt: '2026-09-03T00:00:00+08:00',
  }
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getEntriesForRange') return [{ date: entry.entryDate, entries: [entry] }]
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)

  await user.click((await screen.findAllByRole('button', { name: '時間軸' }))[0])
  await user.click(await screen.findByRole('button', { name: '閱讀記事：來源測試' }))
  expect(screen.getByRole('button', { name: '返回時間軸' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '返回時間軸' }))

  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  await user.click(await screen.findByRole('button', { name: '閱讀記事：來源測試' }))
  expect(screen.getByRole('button', { name: '返回日曆' })).toBeInTheDocument()
})

test('依記事時區初始化日曆，保存模式並以焦點日期查詢正確期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  const user = userEvent.setup()
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'week')
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') return []
    throw new Error(`未預期的請求：${request.action}`)
  })

  render(<App client={createClient({ run: run as JournalClient['run'] })} />)

  expect(await screen.findByRole('heading', { name: '2026年8月31日－9月6日' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
  expect(run).toHaveBeenCalledWith({
    action: 'getEntriesForRange',
    from: '2026-08-31',
    to: '2026-09-06',
    filter: { query: '', from: null, to: null, categoryId: null, tag: null },
  })

  await user.click(screen.getByRole('button', { name: '日' }))
  expect(screen.getByRole('heading', { name: '2026年9月2日 星期三' })).toBeInTheDocument()
  expect(window.localStorage.getItem('daily-journal:calendar-mode')).toBe('day')

  await user.click(screen.getByRole('button', { name: '後一天' }))
  expect(screen.getByRole('heading', { name: /2026年9月3日/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '月' }))
  await user.click(screen.getByRole('button', { name: '下一個月' }))
  expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '今天' }))
  expect(screen.getByRole('heading', { name: '2026年9月' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByRole('button', { name: '日' }))
  await user.click(screen.getByRole('button', { name: '後一天' }))
  expect(screen.getByRole('heading', { name: /2026年9月3日/ })).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '時間軸' })[0])
  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  expect(await screen.findByRole('heading', { name: '2026年9月2日 星期三' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')
})

test('日曆區間查詢與期間計數反映所有篩選條件', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  const user = userEvent.setup()
  window.localStorage.setItem('daily-journal:view', 'calendar')
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00',
  }
  const matching = {
    id: 'matching', entryDate: '2026-09-03', title: '週會', content: '內容', categoryId: 'work',
    tags: ['會議'], links: [], createdAt: '2026-09-03T09:00:00+08:00', updatedAt: '2026-09-03T09:00:00+08:00',
  }
  const other = { ...matching, id: 'other', title: '其他' }
  const rangeRequests: Extract<ApiRequest, { action: 'getEntriesForRange' }>[] = []
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: ['會議'] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 2 } }
    if (request.action === 'listEntries') return { items: [], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeRequests.push(request)
      const filtered = request.filter.query === '週會'
        && request.filter.from === '2026-09-01'
        && request.filter.to === '2026-09-30'
        && request.filter.categoryId === 'work'
        && request.filter.tag === '會議'
      return filtered
        ? [{ date: matching.entryDate, entries: [matching] }]
        : [{ date: matching.entryDate, entries: [matching, other] }]
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  expect(await screen.findByText('本月共有 2 則記事')).toBeInTheDocument()

  await user.click(screen.getAllByRole('button', { name: '開啟搜尋與篩選' })[0])
  await user.type(screen.getByPlaceholderText('搜尋記事...'), '週會')
  fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-09-30' } })
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.selectOptions(screen.getByLabelText('標籤'), '會議')

  await waitFor(() => expect(rangeRequests.at(-1)?.filter).toEqual({
    query: '週會',
    from: '2026-09-01',
    to: '2026-09-30',
    categoryId: 'work',
    tag: '會議',
  }))
  expect(await screen.findByText('本月共有 1 則記事')).toBeInTheDocument()
})

test('日曆頁不執行時間軸 listEntries，篩選只重查目前期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  const user = userEvent.setup()
  window.localStorage.setItem('daily-journal:view', 'calendar')
  let listEntriesCount = 0
  let timelineAllowed = false
  const listRequests: Extract<ApiRequest, { action: 'listEntries' }>[] = []
  const rangeRequests: Extract<ApiRequest, { action: 'getEntriesForRange' }>[] = []
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [], entryCounts: {} }
    if (request.action === 'listEntries') {
      listEntriesCount += 1
      listRequests.push(request)
      if (!timelineAllowed) throw new Error('時間軸查詢不應在日曆執行')
      return { items: [], nextCursor: null }
    }
    if (request.action === 'getEntriesForRange') {
      rangeRequests.push(request)
      return []
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  expect(await screen.findByText('本月共有 0 則記事')).toBeInTheDocument()

  await user.click(screen.getAllByRole('button', { name: '開啟搜尋與篩選' })[0])
  await user.type(screen.getByPlaceholderText('搜尋記事...'), '週會')

  await waitFor(() => expect(rangeRequests.at(-1)?.filter.query).toBe('週會'))
  expect(listEntriesCount).toBe(0)
  expect(screen.queryByText('時間軸查詢不應在日曆執行')).not.toBeInTheDocument()

  timelineAllowed = true
  await user.click(screen.getAllByRole('button', { name: '時間軸' })[0])
  await waitFor(() => expect(listEntriesCount).toBe(1))
  expect(listRequests[0].filter).toEqual(expect.objectContaining({ query: '週會', cursor: null }))
})

test('類別顏色完成更新時重繪日曆，但不額外查詢期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'day')
  const user = userEvent.setup()
  const colorRequest = deferred<unknown>()
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-02T00:00:00+08:00', updatedAt: '2026-09-02T00:00:00+08:00',
  }
  const entry = {
    id: 'color-entry', entryDate: '2026-09-02', title: '顏色記事', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: '2026-09-02T09:00:00+08:00', updatedAt: '2026-09-02T09:00:00+08:00',
  }
  let rangeCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: 1 } }
    if (request.action === 'listEntries') return { items: [entry], nextCursor: null }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      return [{ date: entry.entryDate, entries: [entry] }]
    }
    if (request.action === 'setCategoryColor') return colorRequest.promise
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  await screen.findByText('顏色記事')

  await user.click(screen.getAllByRole('button', { name: '類別管理' })[0])
  await user.click(screen.getByRole('button', { name: '設定「工作」的類別顏色' }))
  await user.click(screen.getByRole('menuitemradio', { name: '黃' }))
  await waitFor(() => expect(run).toHaveBeenCalledWith({ action: 'setCategoryColor', id: 'work', color: '#ffe784' }))
  await user.click(screen.getAllByRole('button', { name: '日曆' })[0])
  await waitFor(() => expect(rangeCount).toBe(2))

  await act(async () => {
    colorRequest.resolve({ ...category, color: '#ffe784' })
  })
  await waitFor(() => expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#ffe784' }))
  expect(rangeCount).toBe(2)
})

test('日視角編輯與刪除成功後依序刷新目前期間', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T16:30:00.000Z'))
  window.localStorage.setItem('daily-journal:view', 'calendar')
  window.localStorage.setItem('daily-journal:calendar-mode', 'day')
  const user = userEvent.setup()
  const category = {
    id: 'work', name: '工作', color: null, isActive: true,
    createdAt: '2026-09-02T00:00:00+08:00', updatedAt: '2026-09-02T00:00:00+08:00',
  }
  const original = {
    id: 'edit-delete', entryDate: '2026-09-02', title: '編輯前記事', content: '內容', categoryId: 'work',
    tags: [], links: [], createdAt: '2026-09-02T09:00:00+08:00', updatedAt: '2026-09-02T09:00:00+08:00',
  }
  let current: Entry | undefined = original
  let rangeCount = 0
  const run = vi.fn(async (request: ApiRequest) => {
    if (request.action === 'bootstrap') return { timezone: 'Asia/Taipei', categories: [category], tagSuggestions: [] }
    if (request.action === 'listCategories') return { categories: [category], entryCounts: { work: current ? 1 : 0 } }
    if (request.action === 'getEntriesForRange') {
      rangeCount += 1
      return current ? [{ date: current.entryDate, entries: [current] }] : []
    }
    if (request.action === 'saveEntry') {
      current = { ...original, ...request.entry, id: original.id, updatedAt: '2026-09-02T10:00:00+08:00' }
      return current
    }
    if (request.action === 'deleteEntry') {
      current = undefined
      return null
    }
    throw new Error(`未預期的請求：${request.action}`)
  })
  render(<App client={createClient({ run: run as JournalClient['run'] })} />)
  await screen.findByText('編輯前記事')

  await user.click(screen.getByRole('button', { name: '編輯 編輯前記事' }))
  await user.clear(screen.getByLabelText('記事標題'))
  await user.type(screen.getByLabelText('記事標題'), '編輯後記事')
  await user.click(screen.getByRole('button', { name: '儲存變更' }))
  expect(await screen.findByText('編輯後記事')).toBeInTheDocument()
  expect(rangeCount).toBe(2)

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '永久刪除' }))
  expect(await screen.findByText('這天還沒有符合條件的記事')).toBeInTheDocument()
  expect(rangeCount).toBe(3)
})

function createClient(
  overrides: Partial<JournalClient> & Partial<ProvisioningClient> & Partial<AccountClient> = {},
): JournalClient & ProvisioningClient & AccountClient {
  const initialStatus = {
    phase: 'initial_choice' as const,
    sheetName: null,
    lastUpdatedAt: null,
    connectionVersion: null,
    canDeleteActiveSystemSheet: false,
    errorCode: null,
  }
  return {
    restoreSession: vi.fn(async () => 'authenticated' as const),
    beginSignIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
    run: vi.fn(),
    getProvisioningStatus: vi.fn(async () => initialStatus),
    listCandidateSheets: vi.fn(async () => ({ items: [], nextCursor: null })),
    createSheet: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    selectCandidate: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    submitSheetUrl: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    confirmProvisioning: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    startSheetChange: vi.fn(async () => initialStatus),
    cancelSheetChange: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
