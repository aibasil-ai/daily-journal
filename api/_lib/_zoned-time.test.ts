import { describe, expect, test } from 'vitest'
import { formatZonedTimestamp } from './zoned-time'

describe('formatZonedTimestamp', () => {
  test('依指定時區產生含 longOffset 的可排序 ISO 8601 時間字串', () => {
    const timestamp = formatZonedTimestamp(
      new Date('2026-01-02T03:04:05.678Z'),
      'Asia/Taipei',
    )

    expect(timestamp).toBe('2026-01-02T11:04:05.678+08:00')
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })

  test('正確處理夏令時間 offset，且同一時區的時間字串可排序', () => {
    const earlier = formatZonedTimestamp(new Date('2026-07-02T03:04:05.006Z'), 'America/New_York')
    const later = formatZonedTimestamp(new Date('2026-07-02T03:04:06.006Z'), 'America/New_York')

    expect(earlier).toBe('2026-07-01T23:04:05.006-04:00')
    expect(earlier < later).toBe(true)
  })
})
