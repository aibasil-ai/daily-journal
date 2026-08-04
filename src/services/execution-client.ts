import type { RuntimeConfig } from '../config/runtime-config'
import type { ApiRequest, ApiResponse } from '../domain/journal'
import { zhTW } from '../i18n/zh-TW'

type AccessTokenProvider = {
  getAccessToken(): Promise<string>
}

type ExecutionResponse = {
  response?: { result?: ApiResponse<unknown> }
  error?: { message?: string }
}

export class AuthenticationError extends Error {
  constructor(message = zhTW.auth.expired) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class ExecutionClient {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly oauth: AccessTokenProvider,
  ) {}

  async run<T>(request: ApiRequest): Promise<T> {
    const response = await fetch(`https://script.googleapis.com/v1/scripts/${this.config.gasScriptId}:run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.oauth.getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ function: 'executeAppRequest', parameters: [request] }),
    })

    if (response.status === 401 || response.status === 403) throw new AuthenticationError()

    const body = await response.json() as ExecutionResponse
    if (body.error) throw new Error(body.error.message ?? zhTW.api.invalidResponse)

    const result = body.response?.result
    if (!result) throw new Error(zhTW.api.invalidResponse)
    if (!result.ok) throw new Error(result.message)

    return result.data as T
  }
}
