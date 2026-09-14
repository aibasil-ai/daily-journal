import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getInitialView, readViewPreference, saveViewPreference } from './view-preference'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('檢視偏好', () => {
  test('沒有偏好時依螢幕寬度選擇預設檢視', () => {
    expect(getInitialView(375, null)).toBe('timeline')
    expect(getInitialView(768, null)).toBe('calendar')
  })

  test('已儲存的偏好優先於裝置尺寸', () => {
    saveViewPreference('calendar')
    expect(readViewPreference()).toBe('calendar')
    expect(getInitialView(375, readViewPreference())).toBe('calendar')
  })

  test('主檢視偏好在 localStorage 被拒絕時安全回退', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    expect(readViewPreference()).toBeNull()
    expect(() => saveViewPreference('calendar')).not.toThrow()
  })
})
