// @vitest-environment node

import { expect, test } from 'vitest'
import { dateInTimeZone, monthInTimeZone } from './time-zone'

test('以指定時區從固定 instant 取得 ISO 日期與月份', () => {
  const instant = new Date('2026-08-01T00:30:00.000Z')

  expect(dateInTimeZone('America/Los_Angeles', instant)).toBe('2026-07-31')
  expect(monthInTimeZone('America/Los_Angeles', instant)).toBe('2026-07')
  expect(dateInTimeZone('Asia/Taipei', instant)).toBe('2026-08-01')
  expect(monthInTimeZone('Asia/Taipei', instant)).toBe('2026-08')
})
