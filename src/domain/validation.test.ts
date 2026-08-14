import { describe, expect, test } from 'vitest'
import { normalizeEntryInput, validateEntryInput } from './validation'

describe('記事輸入驗證', () => {
  test('去除空白、重複標籤與空白連結', () => {
    expect(normalizeEntryInput({
      entryDate: '2026-08-04',
      title: ' 標題 ',
      content: ' 內容 ',
      categoryId: 'work',
      tags: [' 工作 ', '工作', ''],
      links: [{ label: ' 文件 ', url: ' https://example.com ' }, { label: '', url: '' }],
    })).toEqual({
      entryDate: '2026-08-04',
      title: '標題',
      content: '內容',
      categoryId: 'work',
      tags: ['工作'],
      links: [{ label: '文件', url: 'https://example.com' }],
    })
  })

  test('拒絕空白內容、停用分類與無效連結', () => {
    const issues = validateEntryInput({
      entryDate: '2026-08-04',
      title: '',
      content: ' ',
      categoryId: 'old',
      tags: [],
      links: [{ label: '文件', url: 'ftp://example.com' }],
    }, new Set(['work']))

    expect(issues.map((issue) => issue.field)).toEqual(['content', 'categoryId', 'links'])
  })
})
