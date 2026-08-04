// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { validateEntryInput } from './validation'

describe('validateEntryInput', () => {
  test('接受有主機名稱且無空白的 http 與 https 絕對網址', () => {
    expect(validateLink('http://example.com/path')).toEqual([])
    expect(validateLink('https://journal.example.com/path?tag=work#today')).toEqual([])
  })

  test('拒絕 ftp、相對路徑與含空白的網址', () => {
    expect(validateLink('ftp://example.com')).toEqual(['links'])
    expect(validateLink('/relative-path')).toEqual(['links'])
    expect(validateLink('https://example.com/has space')).toEqual(['links'])
  })

  test('只接受範圍為 0 到 65535 的數字連接埠', () => {
    expect(validateLink('https://example.com:0')).toEqual([])
    expect(validateLink('https://example.com:65535')).toEqual([])
    expect(validateLink('https://example.com:99999')).toEqual(['links'])
    expect(validateLink('https://example.com:http')).toEqual(['links'])
    expect(validateLink('https://example.com:-1')).toEqual(['links'])
  })
})

function validateLink(url: string): string[] {
  return validateEntryInput({
    entryDate: '2026-08-04',
    title: '',
    content: '記事內容',
    categoryId: 'work',
    tags: [],
    links: [{ label: '參考連結', url }],
  }, new Set(['work'])).map((issue) => issue.field)
}
