import { afterEach, describe, expect, test, vi } from 'vitest'
import { ConfigError, loadRuntimeConfig } from './runtime-config'

afterEach(() => {
  delete window.__JOURNAL_CONFIG__
  vi.unstubAllGlobals()
})

describe('loadRuntimeConfig', () => {
  test('優先使用靜態 app-config 設定', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: 'build-id',
      gasScriptId: 'build-script',
    })
    window.__JOURNAL_CONFIG__ = {
      googleClientId: 'runtime-id',
      gasScriptId: 'runtime-script',
    }

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'runtime-id',
      gasScriptId: 'runtime-script',
    })
  })

  test('靜態設定空白時使用編譯期設定', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: 'build-id',
      gasScriptId: 'build-script',
    })
    window.__JOURNAL_CONFIG__ = {
      googleClientId: ' ',
      gasScriptId: '',
    }

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'build-id',
      gasScriptId: 'build-script',
    })
  })

  test('缺少部署設定時提供處理指引', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: '',
      gasScriptId: '',
    })

    expect(() => loadRuntimeConfig()).toThrow(ConfigError)
    expect(() => loadRuntimeConfig()).toThrow(
      '找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_SCRIPT_ID，或建立 public/app-config.js。',
    )
  })
})
