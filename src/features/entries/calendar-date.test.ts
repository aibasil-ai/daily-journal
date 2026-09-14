import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  clampCalendarAnchorDate,
  formatCalendarMonthDay,
  formatCalendarPeriodTitle,
  formatCalendarWeekday,
  getCalendarDateRange,
  listCalendarDates,
  MAX_CALENDAR_ANCHOR_DATE,
  MAX_CALENDAR_WEEK_ANCHOR_DATE,
  MIN_CALENDAR_ANCHOR_DATE,
  MIN_CALENDAR_WEEK_ANCHOR_DATE,
  shiftCalendarAnchorDate,
} from './calendar-date'

describe('日曆日期工具', () => {
  it('以週一到週日建立跨月與跨年的七日範圍', () => {
    expect(getCalendarDateRange('week', '2026-09-03')).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
    })
    expect(getCalendarDateRange('week', '2027-01-01')).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
    expect(listCalendarDates('2026-08-31', '2026-09-06')).toHaveLength(7)
  })

  it('建立日與閏年月的含頭含尾範圍', () => {
    expect(getCalendarDateRange('day', '2024-02-29')).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    })
    expect(getCalendarDateRange('month', '2024-02-29')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
  })

  it('依模式位移並在月末鉗制日期', () => {
    expect(shiftCalendarAnchorDate('day', '2026-09-03', -1)).toBe('2026-09-02')
    expect(shiftCalendarAnchorDate('week', '2026-09-03', 1)).toBe('2026-09-10')
    expect(shiftCalendarAnchorDate('month', '2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftCalendarAnchorDate('month', '2024-03-31', -1)).toBe('2024-02-29')
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('依模式限制互動焦點年界且不產生畸形或五位數日期', () => {
    expect(clampCalendarAnchorDate('day', '0000-01-01')).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('month', '9999-12-31')).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('week', '0000-01-01')).toBe(MIN_CALENDAR_WEEK_ANCHOR_DATE)
    expect(clampCalendarAnchorDate('week', '9999-12-31')).toBe(MAX_CALENDAR_WEEK_ANCHOR_DATE)
    expect(getCalendarDateRange('day', MIN_CALENDAR_ANCHOR_DATE)).toEqual({
      from: '0000-01-01',
      to: '0000-01-01',
    })
    expect(getCalendarDateRange('month', MAX_CALENDAR_ANCHOR_DATE)).toEqual({
      from: '9999-12-01',
      to: '9999-12-31',
    })
    expect(getCalendarDateRange('week', MIN_CALENDAR_WEEK_ANCHOR_DATE)).toEqual({
      from: '0000-01-03',
      to: '0000-01-09',
    })
    expect(getCalendarDateRange('week', MAX_CALENDAR_WEEK_ANCHOR_DATE)).toEqual({
      from: '9999-12-20',
      to: '9999-12-26',
    })
    expect(shiftCalendarAnchorDate('day', MIN_CALENDAR_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('day', MAX_CALENDAR_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('month', MIN_CALENDAR_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('month', MAX_CALENDAR_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', MIN_CALENDAR_WEEK_ANCHOR_DATE, -1)).toBe(MIN_CALENDAR_WEEK_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', MAX_CALENDAR_WEEK_ANCHOR_DATE, 1)).toBe(MAX_CALENDAR_WEEK_ANCHOR_DATE)
    expect(shiftCalendarAnchorDate('week', '0000-01-04', -1)).toBe('0000-01-04')
    expect(shiftCalendarAnchorDate('week', '9999-12-20', 1)).toBe('9999-12-20')
    expect(listCalendarDates(MAX_CALENDAR_ANCHOR_DATE, MAX_CALENDAR_ANCHOR_DATE))
      .toEqual([MAX_CALENDAR_ANCHOR_DATE])
    expect(() => addCalendarDays('0000-01-01', -1)).toThrow('日曆日期超出四位數年份範圍。')
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow('日曆日期超出四位數年份範圍。')
  })

  it('格式化三種期間、星期與月日', () => {
    expect(formatCalendarPeriodTitle('day', '2026-09-03')).toBe('2026年9月3日 星期四')
    expect(formatCalendarPeriodTitle('week', '2026-09-03')).toBe('2026年8月31日－9月6日')
    expect(formatCalendarPeriodTitle('week', '2027-01-01')).toBe('2026年12月28日－2027年1月3日')
    expect(formatCalendarPeriodTitle('month', '2026-09-03')).toBe('2026年9月')
    expect(formatCalendarWeekday('2026-09-03')).toBe('星期四')
    expect(formatCalendarMonthDay('2026-09-03')).toBe('9月3日')
  })
})