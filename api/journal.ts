import {
  ConnectionStore as FirestoreConnectionStore,
  type ConnectionStore,
} from './_lib/connection-store.js'
import { clearAllSessionCookies } from './_lib/cookies.js'
import { getFirestoreClient } from './_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from './_lib/function-response.js'
import {
  GoogleConnectionError,
  GoogleUpstreamError,
} from './_lib/google-drive.js'
import {
  GoogleOAuthUpstreamError,
  InvalidRefreshTokenError,
} from './_lib/google-oauth.js'
import {
  JournalRequestContextAuthenticationError,
  JournalRequestContextConflictError,
  JournalRequestContextProvisioningRequiredError,
  createJournalRequestContextResolver,
  type JournalRequestContext,
} from './_lib/journal-request-context.js'
import { GoogleSheetsClient } from './_lib/google-sheets.js'
import { RATE_LIMIT_WINDOWS, RateLimitError, RateLimiter } from './_lib/rate-limit.js'
import { getServerConfig, type ServerConfig } from './_lib/server-config.js'
import { SessionStore } from './_lib/session-store.js'
import { SheetsJournalStore } from './_lib/sheets-journal-store.js'
import { isJournalMutation, toApiError } from '../shared/journal/dispatcher.js'
import { isJournalError } from '../shared/journal/errors.js'
import type { ApiResponse } from '../shared/journal/types.js'

const FORBIDDEN_REQUEST_FIELDS = new Set([
  'user',
  'userid',
  'useridentifier',
  'owner',
  'ownerid',
  'google',
  'googlesub',
  'googleuser',
  'googleuserid',
  'email',
  'sub',
  'spreadsheet',
  'spreadsheetid',
  'sheet',
  'sheetid',
  'connection',
  'connectionid',
  'session',
  'sessionid',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
])
const LEASE_BUSY_MESSAGE = '目前有另一項操作正在儲存至 Google Sheet，請稍後再試。'
const LEASE_LOST_MESSAGE = '資料表寫入 lease 已遺失。'
const LEASE_LOST_CONFLICT_MESSAGE = '資料表寫入結果可能未知，請先重新載入確認後再繼續。'
const CONNECTION_CONFLICT_MESSAGE = '日記連線狀態已變更，請重新整理後再試。'
const INACTIVE_CONNECTION_MESSAGE = '找不到作用中的資料表連線。'

export type JournalStore = Pick<SheetsJournalStore, 'execute'>

export type JournalStoreFactory = (
  context: JournalRequestContext,
) => Promise<JournalStore> | JournalStore

export type JournalHandlerDependencies = {
  config: Pick<ServerConfig, 'appOrigin'>
  requireJournalRequestContext: (request: Request) => Promise<JournalRequestContext>
  sessionStore: Pick<SessionStore, 'revokeSession'>
  connections: Pick<
    ConnectionStore,
    | 'markConnectionNeedsReconnect'
    | 'markConnectionNeedsReconnectIfCurrent'
    | 'withSheetWriteLease'
  >
  rateLimiter: Pick<RateLimiter, 'consume'>
  createJournalStore?: JournalStoreFactory
}

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)
  const connections = new FirestoreConnectionStore(firestore)
  return createJournalHandler({
    requireJournalRequestContext: createJournalRequestContextResolver({
      config,
      sessionStore,
      connections,
    }),
    sessionStore,
    connections,
    config,
    rateLimiter: new RateLimiter(firestore),
  })(request)
}

export function createJournalHandler(
  dependencies: JournalHandlerDependencies,
): (request: Request) => Promise<Response> {
  const createJournalStore = dependencies.createJournalStore ?? loadSheetsJournalStore

  return async (request: Request): Promise<Response> => {
    if (!isJsonRequest(request)) return jsonResponse({ error: 'unsupported_media_type' }, 415)
    const body = await readRequestBody(request)
    if (!body || hasForbiddenRequestFields(body)) {
      return jsonResponse({ error: 'invalid_request' }, 400)
    }
    const mutation = isJournalMutation(body)
    if (mutation && !hasAllowedOrigin(request, dependencies.config.appOrigin)) {
      return jsonResponse({ error: 'forbidden' }, 403)
    }

    let context: JournalRequestContext | undefined
    try {
      const requestContext = await dependencies.requireJournalRequestContext(request)
      context = requestContext
      if (mutation) {
        await dependencies.rateLimiter.consume({
          scope: 'journal_write',
          subject: requestContext.user.id,
          ...RATE_LIMIT_WINDOWS.journalWrites,
        })
      }
      const result = mutation
        ? await dependencies.connections.withSheetWriteLease(requestContext.connection.id, async () => {
          const store = await createJournalStore(requestContext)
          return store.execute(body)
        })
        : await (await createJournalStore(requestContext)).execute(body)
      return apiResponse(result)
    } catch (error) {
      if (error instanceof JournalRequestContextProvisioningRequiredError) {
        return jsonResponse({ error: 'provisioning_required' }, 403)
      }
      if (error instanceof JournalRequestContextConflictError) return connectionConflictResponse()
      if (error instanceof JournalRequestContextAuthenticationError) {
        return unauthenticatedResponse(dependencies, error)
      }
      if (error instanceof RateLimitError) return jsonResponse({ error: 'rate_limited' }, 429)
      if (error instanceof InvalidRefreshTokenError || error instanceof GoogleConnectionError || isInactiveConnectionError(error)) {
        return unauthenticatedResponse(dependencies, context)
      }
      if (error instanceof GoogleOAuthUpstreamError || error instanceof GoogleUpstreamError) {
        return upstreamFailureResponse()
      }
      if (isLeaseLostError(error)) return leaseLostConflictResponse()
      if (isLeaseBusyError(error)) return leaseConflictResponse()
      if (isJournalError(error)) return apiResponse(toApiError(error))
      return upstreamFailureResponse()
    }
  }
}

async function loadSheetsJournalStore(context: JournalRequestContext): Promise<JournalStore> {
  return SheetsJournalStore.load({
    client: new GoogleSheetsClient(),
    accessToken: context.accessToken,
    spreadsheetId: context.connection.spreadsheetId,
  })
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await request.json() as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function hasForbiddenRequestFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenRequestFields)
  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.replace(/[_-]/g, '').toLowerCase()
    return FORBIDDEN_REQUEST_FIELDS.has(normalizedKey)
      || normalizedKey.includes('token')
      || hasForbiddenRequestFields(nestedValue)
  })
}

function isJsonRequest(request: Request): boolean {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

function hasAllowedOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get('Origin')
  return origin === null || origin === appOrigin
}

async function unauthenticatedResponse(
  dependencies: JournalHandlerDependencies,
  context?: Pick<JournalRequestContext, 'session' | 'connection'> | JournalRequestContextAuthenticationError,
): Promise<Response> {
  const sessionId = context instanceof JournalRequestContextAuthenticationError
    ? context.sessionId
    : context?.session.sessionId
  const connectionId = context instanceof JournalRequestContextAuthenticationError
    ? context.connectionId
    : context?.connection.id
  const expectedEncryptedRefreshToken = context instanceof JournalRequestContextAuthenticationError
    ? context.expectedEncryptedRefreshToken
    : undefined

  if (connectionId && expectedEncryptedRefreshToken) {
    let marked: boolean
    try {
      marked = await dependencies.connections.markConnectionNeedsReconnectIfCurrent(
        connectionId,
        expectedEncryptedRefreshToken,
      )
    } catch {
      return upstreamFailureResponse()
    }
    if (!marked) return connectionConflictResponse()
  } else if (connectionId) {
    await dependencies.connections.markConnectionNeedsReconnect(connectionId).catch(() => undefined)
  }
  if (sessionId) {
    await dependencies.sessionStore.revokeSession(sessionId).catch(() => undefined)
  }
  return jsonResponse({ error: 'unauthenticated' }, 401, clearAllSessionCookies())
}

function upstreamFailureResponse(): Response {
  return jsonResponse({ error: 'upstream_failure' }, 502)
}

function leaseConflictResponse(): Response {
  return jsonResponse({
    ok: false,
    code: 'CONFLICT',
    message: LEASE_BUSY_MESSAGE,
  }, 409)
}

function leaseLostConflictResponse(): Response {
  return jsonResponse({
    ok: false,
    code: 'CONFLICT',
    message: LEASE_LOST_CONFLICT_MESSAGE,
  }, 409)
}

function connectionConflictResponse(): Response {
  return jsonResponse({
    ok: false,
    code: 'CONFLICT',
    message: CONNECTION_CONFLICT_MESSAGE,
  }, 409)
}

function apiResponse(response: ApiResponse<unknown>): Response {
  if (response.ok) return jsonResponse(response)
  return jsonResponse(response, journalErrorStatus(response.code))
}

function journalErrorStatus(code: string): number {
  if (code === 'CONFLICT' || code === 'LOCK_TIMEOUT') return 409
  if (code === 'NOT_FOUND') return 404
  if (code === 'DATA_ERROR' || code === 'CONFIGURATION_ERROR') return 422
  if (code === 'INVALID_REQUEST' || code === 'INVALID_ACTION' || code === 'VALIDATION_ERROR') return 400
  return 500
}

function isLeaseBusyError(error: unknown): boolean {
  return error instanceof Error && error.message === LEASE_BUSY_MESSAGE
}

function isLeaseLostError(error: unknown): boolean {
  return error instanceof Error && error.message === LEASE_LOST_MESSAGE
}

function isInactiveConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message === INACTIVE_CONNECTION_MESSAGE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
