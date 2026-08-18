import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CategoryManager } from './category-manager'

afterEach(cleanup)

test('點選新增類別會開啟類別名稱表單', async () => {
  const user = userEvent.setup()
  render(
    <CategoryManager
      categories={[{
        id: 'work',
        name: '工作',
        isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00',
        updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={{}}
      onLoadEntryPage={vi.fn().mockResolvedValue({ items: [], nextCursor: null })}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
      onActivate={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  await user.click(screen.getByRole('button', { name: '新增類別' }))

  expect(screen.getByRole('region', { name: '新增類別' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '類別名稱' })).toHaveFocus()
})

test('可重新啟用停用中的類別', async () => {
  const user = userEvent.setup()
  const onActivate = vi.fn().mockResolvedValue(undefined)
  render(
    <CategoryManager
      categories={[{
        id: 'archived',
        name: '舊分類',
        isActive: false,
        createdAt: '2026-08-04T00:00:00+08:00',
        updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={{}}
      onLoadEntryPage={vi.fn().mockResolvedValue({ items: [], nextCursor: null })}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
      onActivate={onActivate}
    />,
  )

  await user.click(screen.getByRole('button', { name: '重新啟用 舊分類' }))

  expect(onActivate).toHaveBeenCalledWith('archived')
})

test('有記事的類別可開啟搬移面板但不可永久刪除', async () => {
  const user = userEvent.setup()
  const onLoadEntryPage = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
  render(
    <CategoryManager
      categories={[{
        id: 'work', name: '工作', isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={{ work: 1 }}
      onLoadEntryPage={onLoadEntryPage}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
      onActivate={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  expect(screen.getByRole('button', { name: '永久刪除 工作' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '搬移 工作 的記事' }))

  expect(await screen.findByRole('dialog', { name: '搬移「工作」的記事' })).toBeInTheDocument()
  expect(onLoadEntryPage).toHaveBeenCalledWith('work', null)
})

test('類別操作圖示提供用途提示，刪除限制不直接顯示於卡片內容', async () => {
  const user = userEvent.setup()
  render(
    <CategoryManager
      categories={[{
        id: 'work', name: '工作', isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={{ work: 1 }}
      onLoadEntryPage={vi.fn().mockResolvedValue({ items: [], nextCursor: null })}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
      onActivate={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  const editButton = screen.getByRole('button', { name: '編輯 工作' })
  const deactivateButton = screen.getByRole('button', { name: '停用 工作' })
  const deleteButton = screen.getByRole('button', { name: '永久刪除 工作' })
  await user.hover(deleteButton)

  expect(screen.getByRole('tooltip', { name: '修改「工作」類別的名稱' })).toBeInTheDocument()
  expect(screen.getByRole('tooltip', { name: '停用「工作」後，新記事將無法選用此類別' })).toBeInTheDocument()
  expect(screen.getByRole('tooltip', { name: '請先搬移所有記事，才能永久刪除此類別。' })).toBeInTheDocument()
  expect(editButton).toHaveAttribute('aria-describedby')
  expect(deactivateButton).toHaveAttribute('aria-describedby')
  expect(deleteButton).toHaveAttribute('aria-describedby')
  expect(screen.getByText('請先搬移所有記事，才能永久刪除此類別。')).toHaveClass('category-action-tooltip__content')
})

test('空類別確認後可永久刪除', async () => {
  const user = userEvent.setup()
  const onDelete = vi.fn().mockResolvedValue(undefined)
  render(
    <CategoryManager
      categories={[{
        id: 'empty', name: '空類別', isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={{ empty: 0 }}
      onLoadEntryPage={vi.fn().mockResolvedValue({ items: [], nextCursor: null })}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onDelete={onDelete}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
      onActivate={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  await user.click(screen.getByRole('button', { name: '永久刪除 空類別' }))
  await user.click(screen.getByRole('button', { name: '永久刪除類別' }))

  expect(onDelete).toHaveBeenCalledWith('empty')
})
