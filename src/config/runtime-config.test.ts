// @vitest-environment jsdom

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

  test('靜態設定空白時使用編譯期設定', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: 'build-id',
      gasDeploymentId: 'build-deployment',
    })
    window.__JOURNAL_CONFIG__ = {
      googleClientId: ' ',
      gasDeploymentId: '',
    }

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'build-id',
      gasDeploymentId: 'build-deployment',
    })
  })

  test('靜態設定含非字串值時使用編譯期設定', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: 'build-id',
      gasDeploymentId: 'build-deployment',
    })
    window.__JOURNAL_CONFIG__ = {
      googleClientId: 123,
      gasDeploymentId: 'runtime-deployment',
    } as unknown as Window['__JOURNAL_CONFIG__']

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'build-id',
      gasDeploymentId: 'build-deployment',
    })
  })

  test('缺少部署設定時提供處理指引', () => {
    vi.stubGlobal('__BUILD_JOURNAL_CONFIG__', {
      googleClientId: '',
      gasDeploymentId: '',
    })

    expect(() => loadRuntimeConfig()).toThrow(ConfigError)
    expect(() => loadRuntimeConfig()).toThrow(
      '找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_DEPLOYMENT_ID，或建立 public/app-config.js。',
    )
  })
})
