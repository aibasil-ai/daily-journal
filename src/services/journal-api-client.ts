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

export type CandidateSpreadsheet = {
  id: string
  name: string
  modifiedTime: string
}

export type UserProfile = {
  name?: string
  email?: string
  picture?: string
}

export type SheetConnectionInfo = {
  spreadsheetId: string
  spreadsheetName: string
  status: string
  connectionVersion: number
}

export type SessionStateResult = {
  state: 'authenticated' | 'provisioning' | 'signed-out'
  user?: UserProfile
  connection?: SheetConnectionInfo
}

export class JournalApiClient {
  async restoreSession(): Promise<SessionStateResult> {
    const response = await request('/api/session', { credentials: 'same-origin' })
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)

    const payload = await readJson(response)
    if (!isRecord(payload) || typeof payload.state !== 'string') {
      // Backward compat for boolean authenticated if any
      if (isRecord(payload) && typeof payload.authenticated === 'boolean') {
        return { state: payload.authenticated ? 'authenticated' : 'signed-out' }
      }
      throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    }

    const state = payload.state === 'authenticated' || payload.state === 'provisioning'
      ? payload.state
      : 'signed-out'

    return {
      state,
      user: isRecord(payload.user) ? (payload.user as UserProfile) : undefined,
      connection: isRecord(payload.connection) ? (payload.connection as SheetConnectionInfo) : undefined,
    }
  }

  beginSignIn(): void {
    window.location.assign('/api/auth/start')
  }

  signOut(): void {
    void request('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined)
  }

  async getCandidates(): Promise<CandidateSpreadsheet[]> {
    const response = await request('/api/sheets/candidates', { credentials: 'same-origin' })
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)

    const payload = await readJson(response)
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    }
    return payload.items as CandidateSpreadsheet[]
  }

  async selectSheet(spreadsheetId: string, spreadsheetName?: string): Promise<void> {
    const response = await request('/api/sheets/select', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId, spreadsheetName }),
    })
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    const payload = await readJson(response)
    if (isRecord(payload) && payload.ok === false && isRecord(payload.error)) {
      throw new JournalApiClientError((payload.error.message as string) || zhTW.errors.generic)
    }
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.generic)
  }

  async createSheet(name?: string): Promise<void> {
    const response = await request('/api/sheets/create', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    const payload = await readJson(response)
    if (isRecord(payload) && payload.ok === false && isRecord(payload.error)) {
      throw new JournalApiClientError((payload.error.message as string) || zhTW.errors.generic)
    }
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.generic)
  }

  async switchSheet(targetSpreadsheetId: string, expectedOriginalVersion: number): Promise<void> {
    const response = await request('/api/sheets/switch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSpreadsheetId, expectedOriginalVersion }),
    })
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    const payload = await readJson(response)
    if (isRecord(payload) && payload.ok === false && isRecord(payload.error)) {
      throw new JournalApiClientError((payload.error.message as string) || zhTW.errors.generic)
    }
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.generic)
  }

  async repairSheet(): Promise<void> {
    const response = await request('/api/sheets/repair', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    const payload = await readJson(response)
    if (isRecord(payload) && payload.ok === false && isRecord(payload.error)) {
      throw new JournalApiClientError((payload.error.message as string) || zhTW.errors.generic)
    }
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.generic)
  }

  async deleteAccount(): Promise<void> {
    const response = await request('/api/account/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    })
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.generic)
  }

  async run<T>(requestBody: ApiRequest): Promise<T> {
    const response = await request('/api/journal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    if (!response.ok && response.status !== 400 && response.status !== 409 && response.status !== 429) {
      throw new JournalApiClientError(zhTW.errors.network)
    }

    const payload = await readJson(response)
    if (!isRecord(payload)) throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)

    // Direct ApiResponse<T> shape: { ok: true, data: T } or { ok: false, error: { message } }
    if (typeof payload.ok === 'boolean') {
      if (!payload.ok) {
        const errorMsg = isRecord(payload.error) && typeof payload.error.message === 'string'
          ? payload.error.message
          : zhTW.errors.service
        throw new JournalApiClientError(errorMsg)
      }
      return payload.data as T
    }

    // Legacy nested shape backward compatibility: { response: { result: { ok: true, data: T } } }
    const result = isRecord(payload.response) && isRecord((payload.response as Record<string, unknown>).result)
      ? ((payload.response as Record<string, unknown>).result as ApiResponse<T>)
      : undefined

    if (result) {
      if (!result.ok) throw new JournalApiClientError(result.message)
      return result.data
    }

    throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
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
    return (await response.json()) as unknown
  } catch {
    throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

