// @vitest-environment jsdom

import '../../test/dialog-setup'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Category } from '../../domain/journal'
import { CategoryManager } from './category-manager'

test('可新增與改名啟用中的分類', async () => {
  const onSave = vi.fn<(_: string, id?: string) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup()

  render(<CategoryManager categories={[category('work', '工作')]} onSave={onSave} onDeactivate={vi.fn()} />)

  await user.type(screen.getByLabelText('新增分類名稱'), '生活')
  await user.click(screen.getByRole('button', { name: '新增類別' }))
  expect(onSave).toHaveBeenLastCalledWith('生活', undefined)

  await user.click(screen.getByRole('button', { name: '改名 工作' }))
  const nameInput = screen.getByLabelText('分類名稱 工作')
  await user.clear(nameInput)
  await user.type(nameInput, '職場')
  await user.click(screen.getByRole('button', { name: '儲存分類名稱' }))
  expect(onSave).toHaveBeenLastCalledWith('職場', 'work')
})

test('停用分類前顯示歷史記事仍會保留的說明', async () => {
  const user = userEvent.setup()

  render(<CategoryManager categories={[category('work', '工作')]} onSave={vi.fn()} onDeactivate={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: '停用 工作' }))

  expect(screen.getByRole('dialog', { name: '停用分類確認' })).toBeInTheDocument()
  expect(screen.getByText('停用後，既有記事會保留此分類，新記事不可再選用。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '確認停用' })).toHaveFocus()
})

test('取消停用後焦點回到觸發按鈕', async () => {
  const user = userEvent.setup()

  render(<CategoryManager categories={[category('work', '工作'), category('life', '生活')]} onSave={vi.fn()} onDeactivate={vi.fn()} />)

  const deactivateButton = screen.getByRole('button', { name: '停用 工作' })
  await user.click(deactivateButton)
  await user.click(screen.getByRole('button', { name: '取消' }))

  expect(deactivateButton).toHaveFocus()
})

test('成功停用並卸載觸發按鈕後焦點移至分類管理標題', async () => {
  const user = userEvent.setup()
  const onDeactivate = vi.fn(async () => {
    rerender(<CategoryManager categories={[category('work', '工作', false)]} onSave={vi.fn()} onDeactivate={onDeactivate} />)
  })
  const { rerender } = render(<CategoryManager categories={[category('work', '工作')]} onSave={vi.fn()} onDeactivate={onDeactivate} />)

  await user.click(screen.getByRole('button', { name: '停用 工作' }))
  await user.click(screen.getByRole('button', { name: '確認停用' }))

  expect(screen.queryByRole('button', { name: '停用 工作' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '類別管理' })).toHaveFocus()
})

test('分類以卡片呈現且停用分類保留狀態標籤', () => {
  render(<CategoryManager categories={[category('work', '工作'), category('old', '舊分類', false)]} onSave={vi.fn()} onDeactivate={vi.fn()} />)

  expect(screen.getByRole('list', { name: '分類清單' })).toHaveClass('category-manager__grid')
  expect(screen.getByText('已停用')).toBeInTheDocument()
})

test('類別管理頁首提供說明與新增類別操作', () => {
  render(<CategoryManager categories={[category('work', '工作')]} onSave={vi.fn()} onDeactivate={vi.fn()} />)

  const pageHeader = screen.getByRole('heading', { name: '類別管理' }).closest('header')
  expect(pageHeader).toHaveClass('journal-page-header')
  expect(within(pageHeader!).getByText('組織與管理您的記事分類')).toBeInTheDocument()
  expect(within(pageHeader!).getByRole('button', { name: '新增類別' })).toBeInTheDocument()
})

test('停用的分類在清單中標示已停用且不可再操作', () => {
  render(<CategoryManager categories={[category('archived', '舊分類', false)]} onSave={vi.fn()} onDeactivate={vi.fn()} />)

  expect(screen.getByText('舊分類')).toBeInTheDocument()
  expect(screen.getByText('已停用')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '停用 舊分類' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '改名 舊分類' })).not.toBeInTheDocument()
})

function category(id: string, name: string, isActive = true): Category {
  return {
    id,
    name,
    isActive,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}
