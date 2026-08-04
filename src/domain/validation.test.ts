import { describe, expect, test } from 'vitest'
import { normalizeEntryInput, validateEntryInput } from './validation'

describe('normalizeEntryInput', () => {
  test('去除文字空白、排除空標籤並保留首次出現的標籤', () => {
    expect(normalizeEntryInput({
      entryDate: '2026-08-04',
      title: '  週會  ',
      content: '  完成紀錄  ',
      categoryId: 'work',
      tags: ['  會議 ', '', '會議', ' 專案 '],
      links: [
        { label: '  會議紀錄 ', url: ' https://example.com/meeting ' },
        { label: ' ', url: ' ' },
      ],
    })).toEqual({
      entryDate: '2026-08-04',
      title: '週會',
      content: '完成紀錄',
      categoryId: 'work',
      tags: ['會議', '專案'],
      links: [{ label: '會議紀錄', url: 'https://example.com/meeting' }],
    })
  })
})

describe('validateEntryInput', () => {
  test('拒絕空白內文與停用分類', () => {
    const issues = validateEntryInput(
      { entryDate: '2026-08-04', title: '', content: ' ', categoryId: 'old', tags: [], links: [] },
      new Set(['work']),
    )

    expect(issues.map((issue) => issue.field)).toEqual(['content', 'categoryId'])
  })

  test('拒絕無效日期與沒有名稱或 http 網址的連結', () => {
    const issues = validateEntryInput(
      {
        entryDate: '2026/08/04',
        title: '',
        content: '內容',
        categoryId: 'work',
        tags: [],
        links: [
          { label: '', url: 'https://example.com' },
          { label: '文件', url: 'ftp://example.com' },
        ],
      },
      new Set(['work']),
    )

    expect(issues).toEqual([
      { field: 'entryDate', message: '請選擇記錄日期。' },
      { field: 'links', message: '每個連結都需要名稱與有效的 http 或 https 網址。' },
      { field: 'links', message: '每個連結都需要名稱與有效的 http 或 https 網址。' },
    ])
  })
})
