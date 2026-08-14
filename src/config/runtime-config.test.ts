import { afterEach, describe, expect, test, vi } from 'vitest'
import { ConfigError, loadRuntimeConfig } from './runtime-config'

afterEach(() => {
  window.__JOURNAL_CONFIG__ = undefined
  vi.unstubAllGlobals()
})

describe('執行期設定', () => {
  test('優先使用靜態 app-config 設定', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: 'build-id',
      gasDeploymentId: 'build-deployment',
    })
    window.__JOURNAL_CONFIG__ = {
      googleClientId: 'runtime-id',
      gasDeploymentId: 'runtime-deployment',
    }

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'runtime-id',
      gasDeploymentId: 'runtime-deployment',
    })
  })

  test('缺少設定時提供可操作的錯誤', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: '',
      gasDeploymentId: '',
    })

    expect(() => loadRuntimeConfig()).toThrow(ConfigError)
    expect(() => loadRuntimeConfig()).toThrow('APP_GOOGLE_CLIENT_ID')
  })
})
