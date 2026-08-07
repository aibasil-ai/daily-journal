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

test('先開新增 Dialog 再編輯既有記事時以既有資料重新初始化', async () => {
  const user = userEvent.setup()
  const categories = [category('work'), category('personal')]
  const { rerender } = render(<EntryEditorDialog open categories={categories} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)

  await user.type(screen.getByLabelText('標題（選填）'), '草稿標題')
  await user.type(screen.getByLabelText('記事內容'), '草稿內容')
  await user.selectOptions(screen.getByLabelText('分類'), 'personal')
  await user.type(screen.getByLabelText('標籤'), '草稿{Enter}')
  await user.click(screen.getByRole('button', { name: '新增連結' }))
  await user.type(screen.getByLabelText('連結名稱 1'), '草稿連結')
  await user.type(screen.getByLabelText('連結網址 1'), 'https://example.com/draft')

  rerender(<EntryEditorDialog open={false} categories={categories} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)
  rerender(<EntryEditorDialog open entry={entry('entry-1')} categories={categories} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)

  expect(screen.getByLabelText('記錄日期')).toHaveValue('2026-08-06')
  expect(screen.getByLabelText('標題（選填）')).toHaveValue('既有標題')
  expect(screen.getByLabelText('記事內容')).toHaveValue('既有內容')
  expect(screen.getByLabelText('分類')).toHaveValue('work')
  expect(screen.getByText('會議')).toBeInTheDocument()
  expect(screen.getByLabelText('連結名稱 1')).toHaveValue('既有連結')
  expect(screen.getByLabelText('連結網址 1')).toHaveValue('https://example.com/existing')
})

test('重新開啟新增 Dialog 時清除未儲存資料', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)

  await user.type(screen.getByLabelText('標題（選填）'), '未儲存標題')
  await user.type(screen.getByLabelText('記事內容'), '未儲存內容')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.type(screen.getByLabelText('標籤'), '草稿{Enter}')
  await user.click(screen.getByRole('button', { name: '新增連結' }))

  rerender(<EntryEditorDialog open={false} categories={[category('work')]} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)
  rerender(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={vi.fn()} onRequestClose={vi.fn()} />)

  expect(screen.getByLabelText('標題（選填）')).toHaveValue('')
  expect(screen.getByLabelText('記事內容')).toHaveValue('')
  expect(screen.getByLabelText('分類')).toHaveValue('')
  expect(screen.queryByText('草稿')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('連結名稱 1')).not.toBeInTheDocument()
})

test('新增記事儲存失敗後保留輸入資料', async () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>().mockRejectedValue(new Error('儲存失敗'))
  const user = userEvent.setup()

  render(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={onSave} onRequestClose={vi.fn()} />)

  await user.type(screen.getByLabelText('標題（選填）'), '失敗標題')
  await user.type(screen.getByLabelText('記事內容'), '失敗內容')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.type(screen.getByLabelText('標籤'), '草稿{Enter}')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('儲存失敗')
  expect(screen.getByLabelText('標題（選填）')).toHaveValue('失敗標題')
  expect(screen.getByLabelText('記事內容')).toHaveValue('失敗內容')
  expect(screen.getByLabelText('分類')).toHaveValue('work')
  expect(screen.getByText('草稿')).toBeInTheDocument()
})

test('儲存中禁止關閉，失敗後保留 Dialog、草稿與錯誤', async () => {
  const saving = pendingPromise<void>()
  const onRequestClose = vi.fn()
  const user = userEvent.setup()

  render(<EntryEditorDialog open categories={[category('work')]} tagSuggestions={[]} onSave={() => saving.promise} onRequestClose={onRequestClose} />)

  await user.type(screen.getByLabelText('標題（選填）'), '儲存中的草稿')
  await user.type(screen.getByLabelText('記事內容'), '尚未完成的記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  const dialog = screen.getByRole('dialog')
  expect(screen.getByRole('button', { name: '關閉' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(onRequestClose).not.toHaveBeenCalled()

  saving.reject(new Error('儲存失敗'))

  expect(await screen.findByRole('alert')).toHaveTextContent('儲存失敗')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('標題（選填）')).toHaveValue('儲存中的草稿')
  expect(screen.getByLabelText('記事內容')).toHaveValue('尚未完成的記事')
  expect(screen.getByRole('button', { name: '關閉' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
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
    links: [{ label: '既有連結', url: 'https://example.com/existing' }],
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}

function pendingPromise<T>() {
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })

  return { promise, reject }
}
