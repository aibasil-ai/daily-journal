// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Category, EntryInput } from '../../domain/journal'
import { EntryForm } from './entry-form'

test('提交含標籤與兩筆網址的記事', async () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup()

  render(<EntryForm categories={[category('work')]} onSave={onSave} tagSuggestions={['會議']} />)

  await user.type(screen.getByLabelText('記事內容'), '完成週會紀錄')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.type(screen.getByLabelText('標籤'), '會議{Enter}專案A{Enter}')
  await user.click(screen.getByRole('button', { name: '新增連結' }))
  await user.type(screen.getByLabelText('連結名稱 1'), '會議紀錄')
  await user.type(screen.getByLabelText('連結網址 1'), 'https://example.com/meeting')
  await user.click(screen.getByRole('button', { name: '新增連結' }))
  await user.type(screen.getByLabelText('連結名稱 2'), '簡報')
  await user.type(screen.getByLabelText('連結網址 2'), 'https://example.com/slides')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    categoryId: 'work',
    content: '完成週會紀錄',
    tags: ['會議', '專案A'],
    links: [
      { label: '會議紀錄', url: 'https://example.com/meeting' },
      { label: '簡報', url: 'https://example.com/slides' },
    ],
  }))
})

test('拒絕提交缺少必填欄位或無效連結的記事', async () => {
  const onSave = vi.fn<(_: EntryInput) => Promise<void>>().mockResolvedValue(undefined)
  const user = userEvent.setup()

  render(<EntryForm categories={[category('work')]} onSave={onSave} tagSuggestions={[]} />)

  await user.click(screen.getByRole('button', { name: '儲存記事' }))
  expect(screen.getByText('請選擇啟用中的分類。')).toBeInTheDocument()
  expect(screen.getByText('請輸入記事內容。')).toBeInTheDocument()

  await user.type(screen.getByLabelText('記事內容'), '有連結的記事')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.click(screen.getByRole('button', { name: '新增連結' }))
  await user.type(screen.getByLabelText('連結名稱 1'), '不安全網址')
  await user.type(screen.getByLabelText('連結網址 1'), 'ftp://example.com')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  expect(screen.getByText('每個連結都需要名稱與有效的 http 或 https 網址。')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
})

test('標籤以逗號新增、去重並可移除', async () => {
  const user = userEvent.setup()

  render(<EntryForm categories={[category('work')]} onSave={vi.fn().mockResolvedValue(undefined)} tagSuggestions={['會議']} />)

  await user.type(screen.getByLabelText('標籤'), '會議,會議,專案A,')

  expect(screen.getAllByText('會議')).toHaveLength(1)
  expect(screen.getByText('專案A')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '移除標籤 會議' }))
  expect(screen.queryByRole('button', { name: '移除標籤 會議' })).not.toBeInTheDocument()
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
