import type { ApiRequest, ApiResponse } from '../domain/journal'
import { zhTW } from '../i18n/zh-TW'

export class AuthenticationError extends Error {
  constructor(message: string = zhTW.errors.authentication) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class JournalApiClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalApiClientError'
  }
}

type ExecutionPayload = {
  response?: { result?: ApiResponse<unknown> }
  error?: { message?: string }
}

export class JournalApiClient {
  async restoreSession(): Promise<boolean> {
    const response = await request('/api/session', { credentials: 'same-origin' })
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)

    const payload = await readJson(response)
    if (!isRecord(payload) || typeof payload.authenticated !== 'boolean') {
      throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    }
    return payload.authenticated
  }

  beginSignIn(): void {
    window.location.assign('/api/auth/start')
  }

  signOut(): void {
    // 登出畫面不等待網路回應，避免使用者看見已失效的本機資料。
    void request('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined)
  }

  async run<T>(requestBody: ApiRequest): Promise<T> {
    const response = await request('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)

    const payload = await readJson(response)
    if (!isExecutionPayload(payload)) throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    if (payload.error) throw new JournalApiClientError(payload.error.message ?? zhTW.errors.service)

    const result = payload.response?.result
    if (!result) throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    if (!result.ok) throw new JournalApiClientError(result.message)
    return result.data as T
  }
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new JournalApiClientError(zhTW.errors.network)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
  }
}

function isExecutionPayload(value: unknown): value is ExecutionPayload {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
