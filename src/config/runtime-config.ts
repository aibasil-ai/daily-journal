import { zhTW } from '../i18n/zh-TW'

export type RuntimeConfig = {
  googleClientId: string
  gasScriptId: string
}

export class ConfigError extends Error {
  constructor() {
    super(zhTW.config.missingDeployment)
    this.name = 'ConfigError'
  }
}

export function loadRuntimeConfig(): RuntimeConfig {
  const runtimeConfig = toRuntimeConfig(window.__JOURNAL_CONFIG__)
  if (runtimeConfig) return runtimeConfig

  const buildConfig = typeof __BUILD_JOURNAL_CONFIG__ === 'undefined'
    ? undefined
    : __BUILD_JOURNAL_CONFIG__
  const config = toRuntimeConfig(buildConfig)
  if (config) return config

  throw new ConfigError()
}

function toRuntimeConfig(config: unknown): RuntimeConfig | undefined {
  if (!config || typeof config !== 'object') return undefined

  const { googleClientId, gasScriptId } = config as Partial<RuntimeConfig>
  if (typeof googleClientId !== 'string' || typeof gasScriptId !== 'string') return undefined

  const normalizedGoogleClientId = googleClientId.trim()
  const normalizedGasScriptId = gasScriptId.trim()
  if (!normalizedGoogleClientId || !normalizedGasScriptId) return undefined

  return {
    googleClientId: normalizedGoogleClientId,
    gasScriptId: normalizedGasScriptId,
  }
}
