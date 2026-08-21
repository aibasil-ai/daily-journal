import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ProvisioningStatus } from '../../services/journal-api-client'
import { DataConnectionSettings } from './data-connection-settings'

afterEach(cleanup)

test('只呈現安全的資料表名稱、連線狀態與最後更新，不顯示資料表識別碼', () => {
  const status = {
    ...connectedStatus,
    sheetName: '我的私人記事',
    spreadsheetId: 'sheet-id-must-never-appear',
  } as ProvisioningStatus & { spreadsheetId: string }

  render(<DataConnectionSettings {...createProps({ status })} />)

  expect(screen.getByText('我的私人記事')).toBeInTheDocument()
  expect(screen.getByText('已連線')).toBeInTheDocument()
  expect(screen.getByText('最後更新')).toBeInTheDocument()
  expect(screen.queryByText('sheet-id-must-never-appear')).not.toBeInTheDocument()
})

test('中斷連線要求可辨識且可取消的 modal 確認對話框', async () => {
  const user = userEvent.setup()
  const onDisconnect = vi.fn(async () => undefined)
  render(<DataConnectionSettings {...createProps({ onDisconnect })} />)

  await user.click(screen.getByRole('button', { name: '中斷連線' }))
  const dialog = screen.getByRole('dialog', { name: '確認中斷資料連線' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(within(dialog).getByText(/您的 Google Sheet 與其中的記事不會被刪除/)).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(onDisconnect).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '中斷連線' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '中斷連線' }))
  await waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce())
})

test('自行連結資料表時停用刪除系統建立 Sheet 的選項，且確認文字必須完全相符', async () => {
  const user = userEvent.setup()
  const onDeleteAccount = vi.fn(async () => undefined)
  render(<DataConnectionSettings {...createProps({ onDeleteAccount })} />)

  await user.click(screen.getByRole('button', { name: '刪除帳號資料' }))
  const dialog = screen.getByRole('dialog', { name: '確認刪除帳號資料' })
  const deleteSystemSheet = within(dialog).getByLabelText('同時刪除系統建立的 Google Sheet')
  const deleteAccount = within(dialog).getByRole('button', { name: '刪除帳號資料' })
  expect(deleteSystemSheet).toBeDisabled()
  expect(deleteAccount).toBeDisabled()

  await user.type(within(dialog).getByLabelText('請輸入「刪除我的帳號」確認'), '刪除我的帳號 ')
  expect(deleteAccount).toBeDisabled()
  await user.clear(within(dialog).getByLabelText('請輸入「刪除我的帳號」確認'))
  await user.type(within(dialog).getByLabelText('請輸入「刪除我的帳號」確認'), '刪除我的帳號')
  expect(deleteAccount).toBeEnabled()
  await user.click(deleteAccount)

  await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledWith({
    deleteSystemCreatedSheet: false,
    confirmation: '刪除我的帳號',
  }))
})

test('系統建立的資料表可選擇一併刪除', async () => {
  const user = userEvent.setup()
  const onDeleteAccount = vi.fn(async () => undefined)
  render(<DataConnectionSettings {...createProps({
    status: { ...connectedStatus, canDeleteActiveSystemSheet: true },
    onDeleteAccount,
  })} />)

  await user.click(screen.getByRole('button', { name: '刪除帳號資料' }))
  const dialog = screen.getByRole('dialog', { name: '確認刪除帳號資料' })
  const deleteSystemSheet = within(dialog).getByLabelText('同時刪除系統建立的 Google Sheet')
  expect(deleteSystemSheet).toBeEnabled()
  await user.click(deleteSystemSheet)
  await user.type(within(dialog).getByLabelText('請輸入「刪除我的帳號」確認'), '刪除我的帳號')
  await user.click(within(dialog).getByRole('button', { name: '刪除帳號資料' }))

  await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledWith({
    deleteSystemCreatedSheet: true,
    confirmation: '刪除我的帳號',
  }))
})

test('更換資料表失敗時在設定主畫面顯示錯誤', async () => {
  const user = userEvent.setup()
  render(<DataConnectionSettings {...createProps({
    onStartChange: vi.fn(async () => {
      throw new Error('目前無法開始更換資料表')
    }),
  })} />)

  await user.click(screen.getByRole('button', { name: '更換資料表' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('目前無法開始更換資料表')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('關閉設定確認對話框後回復觸發鈕焦點並限制焦點留在對話框內', async () => {
  const user = userEvent.setup()
  render(<DataConnectionSettings {...createProps()} />)

  const trigger = screen.getByRole('button', { name: '中斷連線' })
  await user.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '確認中斷資料連線' })
  const cancel = within(dialog).getByRole('button', { name: '取消' })
  const confirm = within(dialog).getByRole('button', { name: '中斷連線' })

  await waitFor(() => expect(cancel).toHaveFocus())
  await user.tab({ shift: true })
  expect(confirm).toHaveFocus()
  await user.click(cancel)

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

const connectedStatus: ProvisioningStatus = {
  phase: 'completed',
  sheetName: '每日記事',
  lastUpdatedAt: 1,
  connectionVersion: 8,
  canDeleteActiveSystemSheet: false,
  errorCode: null,
}

function createProps(overrides: Partial<ComponentProps<typeof DataConnectionSettings>> = {}) {
  return {
    status: connectedStatus,
    onStartChange: vi.fn(async () => undefined),
    onDisconnect: vi.fn(async () => undefined),
    onDeleteAccount: vi.fn(async () => undefined),
    ...overrides,
  }
}
