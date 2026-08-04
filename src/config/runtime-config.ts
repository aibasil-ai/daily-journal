export type RuntimeConfig = {
  googleClientId: string
  gasScriptId: string
}

const missingConfigMessage = '找不到部署設定。請設定 APP_GOOGLE_CLIENT_ID 與 APP_GAS_SCRIPT_ID，或建立 public/app-config.js。'

export class ConfigError extends Error {
  constructor() {
    super(missingConfigMessage)
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

function toRuntimeConfig(config: Partial<RuntimeConfig> | undefined): RuntimeConfig | undefined {
  const googleClientId = config?.googleClientId?.trim()
  const gasScriptId = config?.gasScriptId?.trim()

  if (!googleClientId || !gasScriptId) return undefined

  return { googleClientId, gasScriptId }
}
