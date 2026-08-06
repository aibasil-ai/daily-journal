// @vitest-environment jsdom

import '../../test/dialog-setup'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Category, Entry, EntryFilter } from '../../domain/journal'
import { EntryCard } from './entry-card'
import { FilterBar } from './filter-bar'
import { Timeline } from './timeline'

test('依記錄日期分組並僅在有游標時顯示載入更多', async () => {
  const onLoadMore = vi.fn()
  const user = userEvent.setup()
  const { rerender } = render(
    <Timeline entries={[entry('first', '2026-08-04'), entry('second', '2026-08-03')]} categoryNameById={new Map([['work', '工作']])} nextCursor="cursor-2" onEdit={vi.fn()} onDelete={vi.fn()} onLoadMore={onLoadMore} />,
  )

  expect(screen.getByRole('heading', { name: '2026-08-04' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '2026-08-03' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '載入更多' }))
  expect(onLoadMore).toHaveBeenCalledOnce()

  rerender(<Timeline entries={[]} categoryNameById={new Map()} nextCursor={null} onEdit={vi.fn()} onDelete={vi.fn()} onLoadMore={vi.fn()} />)
  expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument()
})

test('標題留空時以記事內容前八十字顯示摘要，外部連結安全開啟', () => {
  const content = '這是一段用來驗證摘要行為的記事內容，會超過八十個字元，以確保卡片顯示正確截斷的標題。'.repeat(2)

  render(<EntryCard entry={entry('empty-title', '2026-08-04', { title: '', content, links: [{ label: '參考資料', url: 'https://example.com' }] })} categoryName="工作" onEdit={vi.fn()} onDelete={vi.fn()} />)

  expect(screen.getByRole('heading', { name: content.slice(0, 80) })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '參考資料' })).toHaveAttribute('target', '_blank')
  expect(screen.getByRole('link', { name: '參考資料' })).toHaveAttribute('rel', 'noreferrer noopener')
})

test('點選記事標題或摘要時傳出閱讀 callback', async () => {
  const onOpen = vi.fn()
  const user = userEvent.setup()
  const openingEntry = entry('opening', '2026-08-04')

  render(<EntryCard entry={openingEntry} categoryName="工作" onOpen={onOpen} onEdit={vi.fn()} onDelete={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: '標題 opening' }))
  await user.click(screen.getByRole('button', { name: '記事內容 opening' }))

  expect(onOpen).toHaveBeenNthCalledWith(1, openingEntry)
  expect(onOpen).toHaveBeenNthCalledWith(2, openingEntry)
})

test('歷史記事透過明確分類名稱顯示停用分類', () => {
  render(<EntryCard {...{ entry: entry('inactive-category', '2026-08-04', { categoryId: 'old' }), categoryName: '舊分類', onEdit: vi.fn(), onDelete: vi.fn() }} />)

  expect(screen.getByText('分類：舊分類')).toBeInTheDocument()
})

test('不產生 data、javascript、ftp 協定的可點擊連結', () => {
  render(<EntryCard entry={entry('unsafe-links', '2026-08-04', {
    links: [
      { label: '資料網址', url: 'data:text/html,unsafe' },
      { label: '腳本網址', url: 'javascript:alert(1)' },
      { label: 'FTP 網址', url: 'ftp://example.com' },
    ],
  })} categoryName="工作" onEdit={vi.fn()} onDelete={vi.fn()} />)

  expect(screen.getByText('資料網址')).toBeInTheDocument()
  expect(screen.getByText('腳本網址')).toBeInTheDocument()
  expect(screen.getByText('FTP 網址')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '資料網址' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '腳本網址' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'FTP 網址' })).not.toBeInTheDocument()
})

test('刪除前要求再次確認，失敗後保留記事並顯示錯誤', async () => {
  const onDelete = vi.fn().mockRejectedValue(new Error('刪除失敗'))
  const user = userEvent.setup()

  render(<EntryCard entry={entry('delete', '2026-08-04')} categoryName="工作" onEdit={vi.fn()} onDelete={onDelete} />)

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  expect(screen.getByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '確認刪除' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  expect(await screen.findByText('刪除失敗')).toBeInTheDocument()
  expect(screen.getByText('記事內容 delete')).toBeInTheDocument()
})

test('卡片成功刪除並卸載觸發按鈕後將焦點移至時間軸', async () => {
  const user = userEvent.setup()

  render(<EntryCardDeleteFallbackHarness />)

  await user.click(screen.getByRole('button', { name: '刪除記事' }))
  await user.click(screen.getByRole('button', { name: '確認刪除' }))

  expect(screen.queryByRole('button', { name: '刪除記事' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('region', { name: '記事時間軸' })).toHaveFocus())
  expect(document.body).not.toHaveFocus()
})

test('任一篩選欄位變動時重設游標並傳出完整複合篩選', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  const filter: EntryFilter = { query: '', from: null, to: null, categoryId: null, tag: null, cursor: 'next-page', limit: 20 }

  render(<FilterBarHarness initialFilter={filter} onChange={onChange} />)

  await user.type(screen.getByLabelText('關鍵字'), '週會')
  expect(onChange).toHaveBeenLastCalledWith({ ...filter, query: '週會', cursor: null })
  await user.type(screen.getByLabelText('起始日期'), '2026-08-01')
  expect(onChange).toHaveBeenLastCalledWith({ ...filter, query: '週會', from: '2026-08-01', cursor: null })
  await user.selectOptions(screen.getByLabelText('分類篩選'), 'work')
  expect(onChange).toHaveBeenLastCalledWith({ ...filter, query: '週會', from: '2026-08-01', categoryId: 'work', cursor: null })
  await user.selectOptions(screen.getByLabelText('標籤篩選'), '會議')
  expect(onChange).toHaveBeenLastCalledWith({ ...filter, query: '週會', from: '2026-08-01', categoryId: 'work', tag: '會議', cursor: null })
})

test('分類篩選器保留停用分類並標示狀態', () => {
  render(
    <FilterBar
      categories={[category('work'), { ...category('old'), name: '舊分類', isActive: false }]}
      tagSuggestions={[]}
      filter={{ query: '', from: null, to: null, categoryId: null, tag: null, cursor: null, limit: 20 }}
      onChange={vi.fn()}
    />,
  )

  expect(screen.getByRole('option', { name: '舊分類（已停用）' })).toHaveValue('old')
})

function FilterBarHarness({ initialFilter, onChange }: { initialFilter: EntryFilter; onChange: (filter: EntryFilter) => void }) {
  const [filter, setFilter] = useState(initialFilter)

  return (
    <FilterBar
      categories={[category('work')]}
      tagSuggestions={['會議']}
      filter={filter}
      onChange={(nextFilter) => {
        setFilter(nextFilter)
        onChange(nextFilter)
      }}
    />
  )
}

function EntryCardDeleteFallbackHarness() {
  const [entries, setEntries] = useState([entry('delete-success', '2026-08-04')])

  return (
    <section className="timeline" aria-label="記事時間軸">
      {entries.map((currentEntry) => (
        <EntryCard
          key={currentEntry.id}
          entry={currentEntry}
          categoryName="工作"
          onEdit={vi.fn()}
          onDelete={async () => setEntries([])}
        />
      ))}
    </section>
  )
}

function category(id: string): Category {
  return {
    id,
    name: id,
    isActive: true,
    createdAt: '2026-08-04T00:00:00+08:00',
    updatedAt: '2026-08-04T00:00:00+08:00',
  }
}

function entry(id: string, entryDate: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    entryDate,
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
