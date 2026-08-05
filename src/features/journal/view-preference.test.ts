// @vitest-environment jsdom

import { afterEach, expect, test } from 'vitest'
import { getInitialView, loadViewPreference, saveViewPreference } from './view-preference'

afterEach(() => {
  window.localStorage.clear()
})

test('沒有已儲存偏好時，手機預設時間軸、平板預設月曆', () => {
  expect(getInitialView(375, null)).toBe('timeline')
  expect(getInitialView(768, null)).toBe('calendar')
})

test('已儲存偏好優先於裝置尺寸', () => {
  expect(getInitialView(375, 'calendar')).toBe('calendar')
})

test('以固定的 localStorage key 儲存並讀取有效檢視偏好', () => {
  saveViewPreference('timeline')

  expect(window.localStorage.getItem('daily-journal:view')).toBe('timeline')
  expect(loadViewPreference()).toBe('timeline')
})

test('忽略無效的已儲存檢視偏好', () => {
  window.localStorage.setItem('daily-journal:view', 'cards')

  expect(loadViewPreference()).toBeNull()
})
