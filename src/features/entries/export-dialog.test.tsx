// @vitest-environment jsdom

import '../../test/dialog-setup'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ExportDialog } from './export-dialog'

test('匯出 Dialog 僅在明確選擇後呼叫範圍', async () => {
  const onExport = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()

  render(<ExportDialog open isExporting={false} onExport={onExport} onRequestClose={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: '匯出全部記事' }))

  expect(onExport).toHaveBeenCalledWith('all')
})

test('匯出中會停用所有匯出動作並顯示錯誤', () => {
  render(<ExportDialog open isExporting error="匯出失敗" onExport={vi.fn()} onRequestClose={vi.fn()} />)

  expect(screen.getByRole('button', { name: '匯出目前篩選結果' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '匯出全部記事' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('匯出失敗')
})

test('點選關閉圖示時要求關閉匯出 Dialog', async () => {
  const onRequestClose = vi.fn()
  const user = userEvent.setup()

  render(<ExportDialog open isExporting={false} onExport={vi.fn()} onRequestClose={onRequestClose} />)

  await user.click(screen.getByRole('button', { name: '關閉' }))

  expect(onRequestClose).toHaveBeenCalledOnce()
})
