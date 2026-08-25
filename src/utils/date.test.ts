import { expect, test } from 'vitest'
import { formatEntryTime, getJournalDate, getJournalMonth } from './date'

test('依指定或裝置時區產生日期、月份與時間', () => {
  const instant = new Date('2026-08-14T16:30:00.000Z')

  expect(getJournalDate('Asia/Taipei', instant)).toBe('2026-08-15')
  expect(getJournalMonth('Asia/Taipei', instant)).toBe('2026-08')
  expect(formatEntryTime('2026-08-14T16:30:00.000Z', 'Asia/Taipei')).toBe('00:30')
  expect(formatEntryTime('2026-08-25T05:33:00.000+00:00', 'Asia/Taipei')).toBe('13:33')
  expect(formatEntryTime('invalid-time')).toBe('')
})
