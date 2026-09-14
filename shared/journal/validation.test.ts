import { describe, expect, it } from 'vitest'
import { assertValidEntryRange } from './validation.js'

describe('assertValidEntryRange', () => {
  it('接受含頭含尾 1 至 42 天的有效日期區間', () => {
    expect(() => assertValidEntryRange('2026-09-03', '2026-09-03')).not.toThrow()
    expect(() => assertValidEntryRange('2026-01-01', '2026-02-11')).not.toThrow()
    expect(() => assertValidEntryRange('2024-02-29', '2024-03-01')).not.toThrow()
    expect(() => assertValidEntryRange('0000-01-01', '0000-01-01')).not.toThrow()
  })

  it.each([
    ['2026-9-03', '2026-09-03', '查詢起始日期格式錯誤。'],
    ['2026-09-03', '2026-02-29', '查詢結束日期格式錯誤。'],
    ['2026-09-04', '2026-09-03', '查詢起始日期不可晚於結束日期。'],
    ['2026-01-01', '2026-02-12', '一次最多查詢 42 天。'],
  ])('拒絕無效區間 %s 至 %s', (from, to, message) => {
    expect(() => assertValidEntryRange(from, to)).toThrow(message)
  })
})