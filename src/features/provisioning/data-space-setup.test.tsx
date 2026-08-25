import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import {
  AuthenticationError,
  type ProvisioningClient,
  type ProvisioningStatus,
} from '../../services/journal-api-client'
import { DataSpaceSetup } from './data-space-setup'

afterEach(cleanup)

const initialStatus: ProvisioningStatus = {
  phase: 'initial_choice',
  sheetName: null,
  lastUpdatedAt: null,
  connectionVersion: null,
  canDeleteActiveSystemSheet: false,
  errorCode: null,
}

test('建立每日記事時避免重複送出，初次設定成功後立即完成', async () => {
  const user = userEvent.setup()
  let resolveCreate: ((value: ProvisioningStatus) => void) | undefined
  const createSheet = vi.fn(() => new Promise<ProvisioningStatus>((resolve) => {
    resolveCreate = resolve
  }))
  const onComplete = vi.fn()
  render(<DataSpaceSetup client={createClient({ createSheet })} mode="initial" onComplete={onComplete} />)

  const createButton = await screen.findByRole('button', { name: '建立「每日記事」' })
  await user.click(createButton)
  await user.click(createButton)

  expect(createSheet).toHaveBeenCalledOnce()
  expect(createButton).toBeDisabled()
  expect(createButton).toHaveTextContent('正在建立 Google Sheet...')

  resolveCreate?.({ ...initialStatus, phase: 'completed', sheetName: '每日記事' })
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
})

test('可用鍵盤搜尋候選並只以選擇代碼提交', async () => {
  const user = userEvent.setup()
  const selectCandidate = vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const }))
  const client = createClient({
    listCandidateSheets: vi.fn(async () => ({
      items: [{ selectionCode: 'choice-a', name: '晨間記事', modifiedTime: '2026-08-20T00:00:00.000Z' }],
      nextCursor: null,
    })),
    selectCandidate,
  })
  const onComplete = vi.fn()
  render(<DataSpaceSetup client={client} mode="initial" onComplete={onComplete} />)

  const searchInput = await screen.findByLabelText('搜尋我的 Google Sheet')
  await user.type(searchInput, '晨間')
  await user.keyboard('{Enter}')

  expect(await screen.findByText('晨間記事')).toBeInTheDocument()
  expect(client.listCandidateSheets).toHaveBeenCalledWith('晨間', null)
  expect(screen.queryByText('choice-a')).not.toBeInTheDocument()

  const selectButton = screen.getByRole('button', { name: '選擇 晨間記事' })
  selectButton.focus()
  await user.keyboard('{Enter}')

  expect(selectCandidate).toHaveBeenCalledWith('choice-a')
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
})

test('可用鍵盤貼上 Google Sheet 網址並只提交網址', async () => {
  const user = userEvent.setup()
  const submitSheetUrl = vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const }))
  const onComplete = vi.fn()
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/...'
  render(<DataSpaceSetup client={createClient({ submitSheetUrl })} mode="initial" onComplete={onComplete} />)

  const urlInput = await screen.findByLabelText('Google Sheet 網址')
  await user.type(urlInput, sheetUrl)
  await user.keyboard('{Enter}')

  expect(submitSheetUrl).toHaveBeenCalledWith(sheetUrl)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
})

test('空白 Google Sheet 網址提交時要求輸入網址', async () => {
  const user = userEvent.setup()
  const submitSheetUrl = vi.fn()
  render(<DataSpaceSetup client={createClient({ submitSheetUrl })} mode="initial" onComplete={vi.fn()} />)

  await user.click(await screen.findByRole('button', { name: '連結這份資料表' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('請輸入 Google Sheet 網址。')
  expect(submitSheetUrl).not.toHaveBeenCalled()
})

test('更換資料表在確認前不會完成，確認後才通知 App 重新載入', async () => {
  const user = userEvent.setup()
  const confirmProvisioning = vi.fn(async () => ({
    ...initialStatus,
    phase: 'completed' as const,
    sheetName: '新的每日記事',
  }))
  const onComplete = vi.fn()
  render(<DataSpaceSetup client={createClient({
    getProvisioningStatus: vi.fn(async () => ({ ...initialStatus, sheetName: '目前的每日記事' })),
    createSheet: vi.fn(async () => ({
      ...initialStatus,
      phase: 'ready_to_confirm' as const,
      sheetName: '新的每日記事',
    })),
    confirmProvisioning,
  })} mode="change" onComplete={onComplete} onCancel={vi.fn()} />)

  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))

  expect(await screen.findByRole('heading', { name: '確認更換資料表' })).toBeInTheDocument()
  expect(onComplete).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '確認更換資料表' }))

  expect(confirmProvisioning).toHaveBeenCalledOnce()
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
})

test('取消更換時先撤銷暫存流程再返回原本畫面', async () => {
  const user = userEvent.setup()
  const cancelSheetChange = vi.fn(async () => undefined)
  const onCancel = vi.fn()
  render(<DataSpaceSetup client={createClient({ cancelSheetChange })} mode="change" onComplete={vi.fn()} onCancel={onCancel} />)

  await user.click(await screen.findByRole('button', { name: '取消更換' }))

  await waitFor(() => expect(cancelSheetChange).toHaveBeenCalledOnce())
  expect(onCancel).toHaveBeenCalledOnce()
})

test('取消更換失敗時保留設定畫面並顯示錯誤', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  render(<DataSpaceSetup client={createClient({
    cancelSheetChange: vi.fn(async () => {
      throw new Error('目前無法取消更換')
    }),
  })} mode="change" onComplete={vi.fn()} onCancel={onCancel} />)

  await user.click(await screen.findByRole('button', { name: '取消更換' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('目前無法取消更換')
  expect(onCancel).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '建立「每日記事」' })).toBeInTheDocument()
})

test('設定失敗時保留介面並顯示可讀錯誤', async () => {
  const user = userEvent.setup()
  render(<DataSpaceSetup client={createClient({
    listCandidateSheets: vi.fn(async () => {
      throw new Error('目前無法讀取候選清單')
    }),
  })} mode="initial" onComplete={vi.fn()} />)

  const searchInput = await screen.findByLabelText('搜尋我的 Google Sheet')
  await user.type(searchInput, '記事')
  await user.keyboard('{Enter}')

  expect(await screen.findByRole('alert')).toHaveTextContent('目前無法讀取候選清單')
  expect(screen.getByRole('button', { name: '建立「每日記事」' })).toBeEnabled()
})

test('資料空間 API 認證失效時通知 App 重新探測 session', async () => {
  const user = userEvent.setup()
  const onSessionInvalidated = vi.fn()
  render(<DataSpaceSetup client={createClient({
    createSheet: vi.fn(async () => {
      throw new AuthenticationError()
    }),
  })} mode="initial" onComplete={vi.fn()} onSessionInvalidated={onSessionInvalidated} />)

  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))

  await waitFor(() => expect(onSessionInvalidated).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: '建立「每日記事」' })).toBeEnabled()
})

test('失敗的更換資料表顯示安全錯誤並提供回復原資料的動作', async () => {
  const user = userEvent.setup()
  const onSessionInvalidated = vi.fn()
  const onCancel = vi.fn()
  render(<DataSpaceSetup client={createClient({
    getProvisioningStatus: vi.fn(async () => ({
      ...initialStatus,
      phase: 'failed' as const,
      errorCode: 'connection_conflict',
    })),
  })} mode="change" onComplete={vi.fn()} onCancel={onCancel} onSessionInvalidated={onSessionInvalidated} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('資料連線已在其他分頁變更')
  await user.click(screen.getByRole('button', { name: '重新讀取原本資料' }))

  expect(onSessionInvalidated).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '取消更換' }))
  expect(onCancel).toHaveBeenCalledOnce()
})

test('資料空間畫面開啟與確認畫面切換時將焦點移至標題', async () => {
  const user = userEvent.setup()
  render(<DataSpaceSetup client={createClient({
    createSheet: vi.fn(async () => ({
      ...initialStatus,
      phase: 'ready_to_confirm' as const,
      sheetName: '新的每日記事',
    })),
  })} mode="change" onComplete={vi.fn()} onCancel={vi.fn()} />)

  const title = await screen.findByRole('heading', { name: '設定您的資料空間' })
  await waitFor(() => expect(title).toHaveFocus())
  await user.click(screen.getByRole('button', { name: '建立「每日記事」' }))

  await waitFor(() => expect(title).toHaveFocus())
})

test('離開資料空間畫面後忽略延遲完成的設定回應', async () => {
  const user = userEvent.setup()
  let resolveCreate: ((value: ProvisioningStatus) => void) | undefined
  const createSheet = vi.fn(() => new Promise<ProvisioningStatus>((resolve) => {
    resolveCreate = resolve
  }))
  const onComplete = vi.fn()
  const { unmount } = render(<DataSpaceSetup client={createClient({ createSheet })} mode="initial" onComplete={onComplete} />)

  await user.click(await screen.findByRole('button', { name: '建立「每日記事」' }))
  unmount()
  await act(async () => {
    resolveCreate?.({ ...initialStatus, phase: 'completed' })
    await Promise.resolve()
  })

  expect(onComplete).not.toHaveBeenCalled()
})

function createClient(overrides: Partial<ProvisioningClient> = {}): ProvisioningClient {
  return {
    getProvisioningStatus: vi.fn(async () => initialStatus),
    listCandidateSheets: vi.fn(async () => ({ items: [], nextCursor: null })),
    createSheet: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    selectCandidate: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    submitSheetUrl: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    confirmProvisioning: vi.fn(async () => ({ ...initialStatus, phase: 'completed' as const })),
    startSheetChange: vi.fn(async () => initialStatus),
    cancelSheetChange: vi.fn(async () => undefined),
    ...overrides,
  }
}
