// @vitest-environment jsdom

import '../../test/dialog-setup'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Entry } from '../../domain/journal'
import { EntryDeleteDialog } from './entry-delete-dialog'
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

test('刪除進行時 Escape 會保留確認 Dialog 與失敗訊息', async () => {
  const deletion = pendingPromise<void>()
  const onRequestClose = vi.fn()
  const user = userEvent.setup()

  render(<EntryDeleteDialog entry={entry('pending')} onDelete={() => deletion.promise} onRequestClose={onRequestClose} />)

  await user.click(screen.getByRole('button', { name: '確認刪除' }))
  fireEvent(screen.getByRole('dialog', { name: '刪除記事確認' }), new Event('cancel', { cancelable: true }))

  expect(onRequestClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()

  deletion.reject(new Error('刪除失敗'))

  expect(await screen.findByRole('alert')).toHaveTextContent('刪除失敗')
  expect(screen.getByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()
})

test('刪除確認透過 native modal 開啟並在取消後關閉', () => {
  const onRequestClose = vi.fn()
  const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
  const close = vi.spyOn(HTMLDialogElement.prototype, 'close')

  try {
    render(<EntryDeleteDialog entry={entry('native-modal')} onDelete={async () => undefined} onRequestClose={onRequestClose} />)

    const dialog = screen.getByRole('dialog', { name: '刪除記事確認' })
    expect(showModal).toHaveBeenCalledOnce()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(close).toHaveBeenCalledOnce()
    expect(onRequestClose).toHaveBeenCalledOnce()
  } finally {
    showModal.mockRestore()
    close.mockRestore()
  }
})

test('取消刪除後把焦點回到觸發按鈕', async () => {
  const user = userEvent.setup()

  render(<DeleteCancellationHarness />)

  const trigger = screen.getByRole('button', { name: '刪除記事' })
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: '取消' }))

  await waitFor(() => expect(trigger).toHaveFocus())
})

test('成功刪除卸載觸發按鈕後將焦點移至閱讀標題', async () => {
  const user = userEvent.setup()

  render(<DeleteSuccessHarness />)

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  expect(screen.queryByRole('button', { name: '刪除記事' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('heading', { name: '閱讀記事' })).toHaveFocus())
})

test('多個刪除 Dialog 使用各自的標題 ID', () => {
  render(
    <>
      <EntryDeleteDialog entry={entry('first')} onDelete={async () => undefined} onRequestClose={vi.fn()} />
      <EntryDeleteDialog entry={entry('second')} onDelete={async () => undefined} onRequestClose={vi.fn()} />
    </>,
  )

  const [firstDialog, secondDialog] = screen.getAllByRole('dialog', { name: '刪除記事確認' })
  const firstTitleId = firstDialog.getAttribute('aria-labelledby')
  const secondTitleId = secondDialog.getAttribute('aria-labelledby')

  expect(firstTitleId).not.toBe(secondTitleId)
  expect(document.getElementById(firstTitleId ?? '')).toHaveTextContent('刪除記事確認')
  expect(document.getElementById(secondTitleId ?? '')).toHaveTextContent('刪除記事確認')
})

function DeleteCancellationHarness() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setIsDeleteDialogOpen(true)}>刪除記事</button>
      {isDeleteDialogOpen && <EntryDeleteDialog entry={entry('cancel')} onDelete={async () => undefined} onRequestClose={() => setIsDeleteDialogOpen(false)} returnFocusRef={triggerRef} />}
    </>
  )
}

function DeleteSuccessHarness() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const readerTitleRef = useRef<HTMLHeadingElement>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [hasEntry, setHasEntry] = useState(true)

  return (
    <>
      <h2 ref={readerTitleRef} tabIndex={-1}>閱讀記事</h2>
      {hasEntry && <button ref={triggerRef} type="button" onClick={() => setIsDeleteDialogOpen(true)}>刪除記事</button>}
      {isDeleteDialogOpen && <EntryDeleteDialog entry={entry('success')} onDelete={async () => setHasEntry(false)} onRequestClose={() => setIsDeleteDialogOpen(false)} returnFocusRef={triggerRef} fallbackFocusRef={readerTitleRef} />}
    </>
  )
}

function pendingPromise<T>() {
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })

  return { promise, reject }
}

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
