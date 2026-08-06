// @vitest-environment jsdom

import '../../test/dialog-setup'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Entry } from '../../domain/journal'
import { EntryPickerDialog } from './entry-picker-dialog'
import { EntryReaderDialog } from './entry-reader-dialog'

test('閱讀 Dialog 顯示記事、可安全開啟連結並轉入編輯', async () => {
  const onEdit = vi.fn()
  const user = userEvent.setup()

  render(
    <EntryReaderDialog
      open
      entry={entry('entry-1', { links: [{ label: '設計稿', url: 'https://example.com/design' }] })}
      categoryName="工作"
      onEdit={onEdit}
      onDelete={vi.fn()}
      onRequestClose={vi.fn()}
    />,
  )

  expect(screen.getByRole('dialog', { name: '閱讀記事' })).toHaveTextContent('記事內容 entry-1')
  expect(screen.getByRole('link', { name: '設計稿' })).toHaveAttribute('target', '_blank')
  expect(screen.getByRole('link', { name: '設計稿' })).toHaveAttribute('rel', 'noreferrer noopener')
  await user.click(screen.getByRole('button', { name: '編輯記事' }))
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }))
})

test('閱讀 Dialog 將不安全連結顯示為文字', () => {
  render(
    <EntryReaderDialog
      open
      entry={entry('unsafe-link', { links: [{ label: '腳本網址', url: 'javascript:alert(1)' }] })}
      categoryName="工作"
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onRequestClose={vi.fn()}
    />,
  )

  expect(screen.getByText('腳本網址')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '腳本網址' })).not.toBeInTheDocument()
})

test('閱讀 Dialog 刪除失敗時顯示錯誤並保留記事', async () => {
  const user = userEvent.setup()

  render(
    <EntryReaderDialog
      open
      entry={entry('delete-failure')}
      categoryName="工作"
      onEdit={vi.fn()}
      onDelete={vi.fn().mockRejectedValue(new Error('刪除失敗'))}
      onRequestClose={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('刪除失敗')
  expect(screen.getByText('記事內容 delete-failure')).toBeInTheDocument()
})

test('同日多筆記事時，選擇正確的記事', async () => {
  const onSelect = vi.fn()
  const user = userEvent.setup()

  render(<EntryPickerDialog open date="2026-08-04" entries={[entry('morning'), entry('evening')]} onSelect={onSelect} onRequestClose={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: '標題 evening' }))

  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'evening' }))
})

test('記事載入後會開啟已請求的閱讀 Dialog', () => {
  const { rerender } = render(
    <EntryReaderDialog
      open
      entry={undefined}
      categoryName="工作"
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onRequestClose={vi.fn()}
    />,
  )

  rerender(
    <EntryReaderDialog
      open
      entry={entry('loaded')}
      categoryName="工作"
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onRequestClose={vi.fn()}
    />,
  )

  expect(screen.getByRole('dialog', { name: '閱讀記事' })).toBeInTheDocument()
})

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    entryDate: '2026-08-04',
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
