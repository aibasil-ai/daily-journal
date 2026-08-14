import type { RuntimeConfig } from '../config/runtime-config'
import type { ApiRequest, ApiResponse } from '../domain/journal'
import { zhTW } from '../i18n/zh-TW'

export interface AccessTokenProvider {
  getAccessToken(prompt?: '' | 'consent'): Promise<string>
}

export class AuthenticationError extends Error {
  constructor(message: string = zhTW.errors.authentication) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionError'
  }
}

type ExecutionPayload = {
  response?: { result?: ApiResponse<unknown> }
  error?: { message?: string }
}

export class ExecutionClient {
  constructor(
    private readonly config: Pick<RuntimeConfig, 'gasDeploymentId'>,
    private readonly oauth: AccessTokenProvider,
  ) {}

  async run<T>(request: ApiRequest): Promise<T> {
    const token = await this.oauth.getAccessToken()
    const response = await fetch(
      `https://script.googleapis.com/v1/scripts/${encodeURIComponent(this.config.gasDeploymentId)}:run`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          function: 'executeAppRequest',
          parameters: [request],
        }),
      },
    )

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError()
    }
    if (!response.ok) {
      throw new ExecutionError(zhTW.errors.network)
    }

    const payload = await response.json() as ExecutionPayload
    if (payload.error) {
      throw new ExecutionError(payload.error.message ?? zhTW.errors.service)
    }

    const result = payload.response?.result
    if (!result) {
      throw new ExecutionError(zhTW.errors.invalidServiceResponse)
    }
    if (!result.ok) {
      throw new ExecutionError(result.message)
    }
    return result.data as T
  }
}
