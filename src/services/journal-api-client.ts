import type { ApiRequest, ApiResponse } from '../domain/journal'
import { zhTW } from '../i18n/zh-TW'

type SessionResponse = {
  authenticated?: unknown
}

type JournalResponse = {
  response?: { result?: ApiResponse<unknown> }
}

export class AuthenticationError extends Error {
  constructor(message = zhTW.auth.expired) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class JournalApiClientError extends Error {
  constructor(message: string = zhTW.api.requestFailed) {
    super(message)
    this.name = 'JournalApiClientError'
  }
}

export class JournalApiClient {
  async restoreSession(): Promise<boolean> {
    const response = await this.fetch('/api/session', { credentials: 'same-origin' })
    const body = await this.readJson<SessionResponse>(response)

    return typeof body.authenticated === 'boolean' ? body.authenticated : this.invalidResponse()
  }

  beginSignIn(): void {
    window.location.assign('/api/auth/start')
  }

  signOut(): void {
    void fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {})
  }

  async run<T>(request: ApiRequest): Promise<T> {
    const response = await this.fetch('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await this.readJson<JournalResponse>(response)
    const result = body.response?.result

    if (!result) return this.invalidResponse()
    if (!result.ok) throw new Error(result.message)

    return result.data as T
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch {
      throw new JournalApiClientError()
    }

    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    if (!response.ok) throw new JournalApiClientError()

    return response
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T
    } catch {
      throw new JournalApiClientError()
    }
  }

  private invalidResponse(): never {
    throw new JournalApiClientError(zhTW.api.invalidResponse)
  }
}
