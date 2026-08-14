import { beforeEach, describe, expect, test } from 'vitest'
import { getInitialView, readViewPreference, saveViewPreference } from './view-preference'

beforeEach(() => window.localStorage.clear())

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
})
