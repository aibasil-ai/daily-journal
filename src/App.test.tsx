import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiRequest } from './domain/journal'
import { App } from './App'
import type { JournalClient } from './features/journal/use-journal'
import { zhTW } from './i18n/zh-TW'
import {
  AuthenticationError,
  type AccountClient,
  type ProvisioningClient,
} from './services/journal-api-client'

afterEach(cleanup)

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
      if (request.action === 'getMonthlyEntries') return []
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
    if (request.action === 'getMonthlyEntries') return []
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
    if (request.action === 'getMonthlyEntries') return []
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
  const oldMonthly = deferred<Array<{ date: string; entries: typeof oldCalendarEntry[] }>>()
  const oldDateEntries = deferred<typeof oldCalendarEntry[]>()
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
    if (request.action === 'getMonthlyEntries') {
      if (changed) return []
      monthlyRequestCount += 1
      if (monthlyRequestCount === 1) return oldMonthly.promise
      selectableDate = `${request.year}-${String(request.month).padStart(2, '0')}-01`
      return [{ date: selectableDate, entries: [{ ...oldCalendarEntry, entryDate: selectableDate }] }]
    }
    if (request.action === 'getEntriesForDate') return oldDateEntries.promise
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

  await user.click((await screen.findAllByRole('button', { name: '月曆' }))[0])
  await screen.findByRole('heading', { name: '月曆' })
  await waitFor(() => expect(monthlyRequestCount).toBe(1))
  await user.click(screen.getByRole('button', { name: '下一個月' }))
  await waitFor(() => expect(monthlyRequestCount).toBe(2))
  await user.click(await screen.findByRole('button', { name: `${selectableDate}，共 1 則記事` }))
  await waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'getEntriesForDate', date: selectableDate })))

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
    if (request.action === 'getMonthlyEntries') return []
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
    if (request.action === 'getMonthlyEntries') return []
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
