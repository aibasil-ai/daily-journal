import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCalendarModePreference, saveCalendarModePreference } from './calendar-mode-preference'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('日曆模式偏好', () => {
  it('預設為月並只接受三種有效模式', () => {
    expect(readCalendarModePreference()).toBe('month')
    window.localStorage.setItem('daily-journal:calendar-mode', 'invalid')
    expect(readCalendarModePreference()).toBe('month')
    for (const mode of ['day', 'week', 'month'] as const) {
      saveCalendarModePreference(mode)
      expect(readCalendarModePreference()).toBe(mode)
    }
  })

  it('瀏覽器拒絕 localStorage 時安全回退且不阻止切換', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    expect(readCalendarModePreference()).toBe('month')
    expect(() => saveCalendarModePreference('week')).not.toThrow()
  })
})