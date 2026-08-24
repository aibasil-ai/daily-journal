import type { ApiRequest, ApiResponse } from '../domain/journal'
import { zhTW } from '../i18n/zh-TW'

export type SessionState = 'authenticated' | 'provisioning' | 'signed-out'

export type ProvisioningPhase =
  | 'initial_choice'
  | 'candidate_selection'
  | 'creating'
  | 'verifying'
  | 'ready_to_confirm'
  | 'completed'
  | 'failed'

export type ProvisioningErrorCode =
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'forbidden'
  | 'rate_limited'
  | 'invalid_selection'
  | 'invalid_sheet_url'
  | 'sheet_unavailable'
  | 'sheet_incompatible'
  | 'already_active'
  | 'connection_conflict'
  | 'provisioning_failed'
  | 'upstream_failure'

export type ProvisioningStatus = {
  phase: ProvisioningPhase
  sheetName: string | null
  lastUpdatedAt: number | null
  connectionVersion: number | null
  canDeleteActiveSystemSheet: boolean
  errorCode: string | null
}

export type CandidateSheet = {
  selectionCode: string
  name: string
  modifiedTime: string
}

export type CandidateSheetPage = {
  items: CandidateSheet[]
  nextCursor: string | null
}

export type DeleteAccountInput = {
  deleteSystemCreatedSheet: boolean
  confirmation: string
}

export interface ProvisioningClient {
  getProvisioningStatus(): Promise<ProvisioningStatus>
  listCandidateSheets(query: string, cursor?: string | null): Promise<CandidateSheetPage>
  createSheet(): Promise<ProvisioningStatus>
  selectCandidate(selectionCode: string): Promise<ProvisioningStatus>
  submitSheetUrl(url: string): Promise<ProvisioningStatus>
  confirmProvisioning(): Promise<ProvisioningStatus>
  startSheetChange(): Promise<ProvisioningStatus>
  cancelSheetChange(): Promise<void>
}

export interface AccountClient {
  disconnect(): Promise<void>
  deleteAccount(input: DeleteAccountInput): Promise<void>
}

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

/** Provisioning API 只會傳回白名單錯誤碼，保留代碼供介面決定安全的復原動作。 */
export class ProvisioningApiError extends JournalApiClientError {
  constructor(readonly code: ProvisioningErrorCode) {
    super(toProvisioningErrorMessage(code))
    this.name = 'ProvisioningApiError'
  }
}

export function toProvisioningErrorMessage(code: string | null | undefined): string {
  return code && isProvisioningErrorCode(code)
    ? zhTW.errors.provisioningCode[code]
    : zhTW.errors.provisioning
}

export class JournalApiClient implements ProvisioningClient, AccountClient {
  async restoreSession(): Promise<SessionState> {
    const response = await request('/api/session')
    assertNotAuthenticationResponse(response)
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)

    const payload = await readJson(response)
    if (!isSessionPayload(payload)) throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
    return payload.state
  }

  beginSignIn(): void {
    window.location.assign('/api/auth/start')
  }

  async signOut(): Promise<void> {
    try {
      const response = await request('/api/auth/logout', {
        method: 'POST',
        keepalive: true,
      })
      if (response.status !== 204) throw new Error('unexpected logout response')
    } catch {
      throw new JournalApiClientError(zhTW.errors.signOut)
    }
  }

  async run<T>(requestBody: ApiRequest): Promise<T> {
    const response = await request('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    assertNotAuthenticationResponse(response)
    const payload = await readJson(response)
    if (!isApiResponse(payload)) {
      throw new JournalApiClientError(response.ok ? zhTW.errors.invalidServiceResponse : zhTW.errors.network)
    }
    if (!payload.ok) throw new JournalApiClientError(payload.message)
    if (!response.ok) throw new JournalApiClientError(zhTW.errors.network)
    return payload.data as T
  }

  async getProvisioningStatus(): Promise<ProvisioningStatus> {
    return readProvisioningResponse(await request('/api/provisioning/status'), isProvisioningStatus)
  }

  async listCandidateSheets(query: string, cursor: string | null = null): Promise<CandidateSheetPage> {
    const parameters = new URLSearchParams({ q: query })
    if (cursor !== null) parameters.set('cursor', cursor)
    return readProvisioningResponse(
      await request(`/api/provisioning/sheets?${parameters.toString()}`),
      isCandidateSheetPage,
    )
  }

  async createSheet(): Promise<ProvisioningStatus> {
    return this.mutateProvisioning('/api/provisioning/create', {})
  }

  async selectCandidate(selectionCode: string): Promise<ProvisioningStatus> {
    return this.mutateProvisioning('/api/provisioning/select', { selectionCode })
  }

  async submitSheetUrl(url: string): Promise<ProvisioningStatus> {
    return this.mutateProvisioning('/api/provisioning/url', { url })
  }

  async confirmProvisioning(): Promise<ProvisioningStatus> {
    return this.mutateProvisioning('/api/provisioning/confirm', {})
  }

  async startSheetChange(): Promise<ProvisioningStatus> {
    return this.mutateProvisioning('/api/provisioning/start-change', {})
  }

  async cancelSheetChange(): Promise<void> {
    const response = await request('/api/provisioning/cancel-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assertNotAuthenticationResponse(response)
    if (response.status === 204) return

    const payload = await tryReadJson(response)
    if (isProvisioningErrorPayload(payload)) throw new ProvisioningApiError(payload.error)
    throw new JournalApiClientError(response.ok ? zhTW.errors.invalidServiceResponse : zhTW.errors.provisioning)
  }

  async disconnect(): Promise<void> {
    return this.mutateAccount('/api/account/disconnect', {})
  }

  async deleteAccount(input: DeleteAccountInput): Promise<void> {
    return this.mutateAccount('/api/account/delete', input)
  }

  private async mutateProvisioning(
    path: string,
    body: Record<string, string> | Record<string, never>,
  ): Promise<ProvisioningStatus> {
    return readProvisioningResponse(await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), isProvisioningStatus)
  }

  private async mutateAccount(
    path: string,
    body: Record<string, string | boolean>,
  ): Promise<void> {
    const response = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    assertNotAuthenticationResponse(response)
    if (response.status === 204) return

    const payload = await readJson(response)
    if (isAccountErrorPayload(payload)) {
      throw new JournalApiClientError(toAccountErrorMessage(payload.error))
    }
    throw new JournalApiClientError(response.ok ? zhTW.errors.invalidServiceResponse : zhTW.errors.accountAction)
  }
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, credentials: 'same-origin' })
  } catch {
    throw new JournalApiClientError(zhTW.errors.network)
  }
}

async function readProvisioningResponse<T>(
  response: Response,
  isExpectedPayload: (value: unknown) => value is T,
): Promise<T> {
  assertNotAuthenticationResponse(response)
  if (!response.ok) {
    const payload = await tryReadJson(response)
    if (isProvisioningErrorPayload(payload)) throw new ProvisioningApiError(payload.error)
    throw new JournalApiClientError(zhTW.errors.provisioning)
  }

  const payload = await readJson(response)
  if (!isExpectedPayload(payload)) throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
  return payload
}

function assertNotAuthenticationResponse(response: Response): void {
  if (response.status === 401 || response.status === 403) throw new AuthenticationError()
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    throw new JournalApiClientError(zhTW.errors.invalidServiceResponse)
  }
}

async function tryReadJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function isSessionPayload(value: unknown): value is { state: SessionState } {
  return isRecord(value)
    && hasOnlyKeys(value, ['state'])
    && (value.state === 'authenticated' || value.state === 'provisioning' || value.state === 'signed-out')
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) return Object.hasOwn(value, 'data')
  return typeof value.code === 'string' && typeof value.message === 'string'
}

function isProvisioningStatus(value: unknown): value is ProvisioningStatus {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'phase',
      'sheetName',
      'lastUpdatedAt',
      'connectionVersion',
      'canDeleteActiveSystemSheet',
      'errorCode',
    ])
    && isProvisioningPhase(value.phase)
    && isNullableString(value.sheetName)
    && isNullableNumber(value.lastUpdatedAt)
    && isNullableNumber(value.connectionVersion)
    && typeof value.canDeleteActiveSystemSheet === 'boolean'
    && isNullableString(value.errorCode)
}

function isCandidateSheetPage(value: unknown): value is CandidateSheetPage {
  return isRecord(value)
    && hasOnlyKeys(value, ['items', 'nextCursor'])
    && Array.isArray(value.items)
    && value.items.every(isCandidateSheet)
    && (value.nextCursor === null || typeof value.nextCursor === 'string')
}

function isCandidateSheet(value: unknown): value is CandidateSheet {
  return isRecord(value)
    && hasOnlyKeys(value, ['selectionCode', 'name', 'modifiedTime'])
    && typeof value.selectionCode === 'string'
    && typeof value.name === 'string'
    && typeof value.modifiedTime === 'string'
}

function isProvisioningErrorPayload(value: unknown): value is { error: ProvisioningErrorCode } {
  return isRecord(value)
    && hasOnlyKeys(value, ['error'])
    && isProvisioningErrorCode(value.error)
}

function isAccountErrorPayload(value: unknown): value is { error: AccountErrorCode } {
  return isRecord(value)
    && hasOnlyKeys(value, ['error'])
    && isAccountErrorCode(value.error)
}

function isProvisioningPhase(value: unknown): value is ProvisioningPhase {
  return value === 'initial_choice'
    || value === 'candidate_selection'
    || value === 'creating'
    || value === 'verifying'
    || value === 'ready_to_confirm'
    || value === 'completed'
    || value === 'failed'
}

function isProvisioningErrorCode(value: unknown): value is ProvisioningErrorCode {
  return value === 'invalid_request'
    || value === 'unsupported_media_type'
    || value === 'forbidden'
    || value === 'rate_limited'
    || value === 'invalid_selection'
    || value === 'invalid_sheet_url'
    || value === 'sheet_unavailable'
    || value === 'sheet_incompatible'
    || value === 'already_active'
    || value === 'connection_conflict'
    || value === 'provisioning_failed'
    || value === 'upstream_failure'
}

type AccountErrorCode =
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'forbidden'
  | 'rate_limited'
  | 'invalid_selection'
  | 'invalid_sheet_url'
  | 'sheet_unavailable'
  | 'sheet_incompatible'
  | 'already_active'
  | 'connection_conflict'
  | 'provisioning_failed'
  | 'upstream_failure'

function isAccountErrorCode(value: unknown): value is AccountErrorCode {
  return value === 'invalid_request'
    || value === 'unsupported_media_type'
    || value === 'forbidden'
    || value === 'rate_limited'
    || value === 'invalid_selection'
    || value === 'invalid_sheet_url'
    || value === 'sheet_unavailable'
    || value === 'sheet_incompatible'
    || value === 'already_active'
    || value === 'connection_conflict'
    || value === 'provisioning_failed'
    || value === 'upstream_failure'
}

function toAccountErrorMessage(code: AccountErrorCode): string {
  return code === 'connection_conflict' ? zhTW.errors.connectionConflict : zhTW.errors.accountAction
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}
