// @vitest-environment jsdom

import '../../test/dialog-setup'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Category, Entry, EntryInput } from '../../domain/journal'
import { EntryEditorDialog } from './entry-editor-dialog'

test('新增記事 Dialog 提交後關閉並傳入既有表單資料', async () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>().mockResolvedValue(undefined)
  const onRequestClose = vi.fn()
  const user = userEvent.setup()

  render(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={onSave} onRequestClose={onRequestClose} />)

  expect(screen.getAllByRole('heading', { level: 2, name: '新增記事' })).toHaveLength(1)
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.type(screen.getByLabelText('記事內容'), '完成設計稿套用')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'work', content: '完成設計稿套用' }))
  expect(onRequestClose).toHaveBeenCalledOnce()
})

test('編輯 Dialog 按取消時要求關閉且不送出', async () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>()
  const onRequestClose = vi.fn()
  const user = userEvent.setup()

  render(<EntryEditorDialog open entry={entry('entry-1')} categories={[category('work')]} tagSuggestions={[]} onSave={onSave} onRequestClose={onRequestClose} />)

  expect(screen.getAllByRole('heading', { level: 2, name: '編輯記事' })).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '取消' }))

  expect(onSave).not.toHaveBeenCalled()
  expect(onRequestClose).toHaveBeenCalledOnce()
})

test('Dialog 收到原生取消事件時要求關閉且不送出', () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>()
  const onRequestClose = vi.fn()

  render(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={onSave} onRequestClose={onRequestClose} />)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))

  expect(onSave).not.toHaveBeenCalled()
  expect(onRequestClose).toHaveBeenCalledOnce()
})

function category(id: string): Category {
  return {
    id,
    name: id,
    isActive: true,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}

function entry(id: string): Entry {
  return {
    id,
    entryDate: '2026-08-06',
    title: '既有標題',
    content: '既有內容',
    categoryId: 'work',
    tags: ['會議'],
    links: [],
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}
