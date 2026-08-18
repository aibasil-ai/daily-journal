import type { ComponentProps } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { Category, Entry, EntryListData } from '../../domain/journal'
import { CategoryEntryMovePanel } from './category-entry-move-panel'

afterEach(cleanup)

const timestamp = '2026-08-18T10:00:00+08:00'

test('可跨已載入頁面勾選多筆記事並在確認後批次搬移', async () => {
  const user = userEvent.setup()
  const onLoadPage = vi.fn(async (_sourceCategoryId: string, cursor: string | null): Promise<EntryListData> => (
    cursor === null
      ? { items: [entry({ id: 'one', content: '第一則' })], nextCursor: 'one' }
      : { items: [entry({ id: 'two', content: '第二則' })], nextCursor: null }
  ))
  const onMoveEntries = vi.fn().mockResolvedValue(undefined)
  renderPanel({ onLoadPage, onMoveEntries })

  await screen.findByText('第一則')
  await user.click(screen.getByRole('checkbox', { name: '選取 第一則' }))
  await user.click(screen.getByRole('button', { name: '載入更多' }))
  await screen.findByText('第二則')
  await user.click(screen.getByRole('checkbox', { name: '選取 第二則' }))

  expect(screen.getByText('已選 2 則')).toBeInTheDocument()
  await user.selectOptions(screen.getByRole('combobox', { name: '移至類別' }), 'life')
  await user.click(screen.getByRole('button', { name: '搬移已選記事' }))
  await user.click(screen.getByRole('button', { name: '確認搬移' }))

  await waitFor(() => expect(onMoveEntries).toHaveBeenCalledWith('work', 'life', ['one', 'two']))
})

test('可從單筆記事操作選擇目的地後確認搬移', async () => {
  const user = userEvent.setup()
  const onMoveEntries = vi.fn().mockResolvedValue(undefined)
  renderPanel({ onMoveEntries })

  await screen.findByText('第一則')
  await user.click(screen.getByRole('button', { name: '搬移記事：第一則' }))
  await user.selectOptions(screen.getByRole('combobox', { name: '移至類別' }), 'life')
  await user.click(screen.getByRole('button', { name: '確認搬移' }))

  await waitFor(() => expect(onMoveEntries).toHaveBeenCalledWith('work', 'life', ['one']))
})

test('沒有其他啟用類別時停用搬移控制項', async () => {
  const user = userEvent.setup()
  renderPanel({ categories: [category()] })

  await screen.findByText('第一則')
  await user.click(screen.getByRole('checkbox', { name: '選取 第一則' }))

  expect(screen.getByText('請先建立或重新啟用另一個類別，才能搬移記事。')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '移至類別' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '搬移已選記事' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '搬移記事：第一則' })).toBeDisabled()
})

test('搬移失敗時保留確認對話框與已選記事', async () => {
  const user = userEvent.setup()
  const onMoveEntries = vi.fn().mockRejectedValue(new Error('伺服器拒絕搬移'))
  renderPanel({ onMoveEntries })

  await screen.findByText('第一則')
  await user.click(screen.getByRole('checkbox', { name: '選取 第一則' }))
  await user.selectOptions(screen.getByRole('combobox', { name: '移至類別' }), 'life')
  await user.click(screen.getByRole('button', { name: '搬移已選記事' }))
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '確認搬移' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('伺服器拒絕搬移')
  expect(screen.getByText('已選 1 則')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '確認搬移' })).toBeInTheDocument()
})

function renderPanel(overrides: Partial<ComponentProps<typeof CategoryEntryMovePanel>> = {}) {
  return render(
    <CategoryEntryMovePanel
      source={category()}
      entryCount={2}
      categories={[category(), category({ id: 'life', name: '生活' })]}
      onLoadPage={async () => ({ items: [entry({ id: 'one', content: '第一則' })], nextCursor: null })}
      onMoveEntries={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
      {...overrides}
    />,
  )
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'work',
    name: '工作',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry',
    entryDate: '2026-08-18',
    title: '',
    content: '內容',
    categoryId: 'work',
    tags: [],
    links: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
