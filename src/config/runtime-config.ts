export type RuntimeConfig = {
  googleClientId: string
  gasDeploymentId: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function loadRuntimeConfig(): RuntimeConfig {
  const runtime = window.__JOURNAL_CONFIG__
  const build = typeof __BUILD_JOURNAL_CONFIG__ === 'undefined'
    ? { googleClientId: '', gasDeploymentId: '' }
    : __BUILD_JOURNAL_CONFIG__
  const googleClientId = nonEmpty(runtime?.googleClientId) ?? nonEmpty(build.googleClientId)
  const gasDeploymentId = nonEmpty(runtime?.gasDeploymentId) ?? nonEmpty(build.gasDeploymentId)

  if (!googleClientId || !gasDeploymentId) {
    throw new ConfigError(zhTW.errors.configuration)
  }

  return { googleClientId, gasDeploymentId }
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
import { zhTW } from '../i18n/zh-TW'
