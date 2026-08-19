import { PROVISIONING_COOKIE_NAME, readCookie, SESSION_COOKIE_NAME } from '../_lib/cookies'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response'
import { refreshGoogleCredentials } from '../_lib/google-oauth'
import { getServerConfig } from '../_lib/server-config'
import { decryptSession } from '../_lib/session-crypto'
import { decryptRefreshToken } from '../_lib/token-crypto'
import { getFirestoreClient } from '../_lib/firestore'
import { SessionStore } from '../_lib/session-store'
import { ConnectionStore } from '../_lib/connection-store'
import { DriveClient } from '../_lib/drive-client'

export function POST(): Response {
  return methodNotAllowed('GET')
}

export async function GET(request: Request): Promise<Response> {
  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch {
    return jsonResponse({ error: 'server_configuration_error' }, 500)
  }

  const firestore = getFirestoreClient()
  const sessionStore = new SessionStore(firestore)
  const connectionStore = new ConnectionStore(firestore)

  const cookieHeader = request.headers.get('Cookie')
  const journalCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  const provCookie = readCookie(cookieHeader, PROVISIONING_COOKIE_NAME)

  let refreshToken: string | undefined

  if (provCookie) {
    const provPayload = decryptSession(provCookie, config.sessionEncryptionKey)
    if (provPayload) {
      const provSession = await sessionStore.resolveProvisioningSession(provPayload.sessionId)
      if (provSession && provSession.provisioningAttemptId) {
        const attempt = await connectionStore.getProvisioningAttempt(provSession.provisioningAttemptId)
        if (attempt?.tempEncryptedRefreshToken) {
          refreshToken = decryptRefreshToken(attempt.tempEncryptedRefreshToken, config.tokenEncryptionKey)
        }
      }
    }
  }

  if (!refreshToken && journalCookie) {
    const journalPayload = decryptSession(journalCookie, config.sessionEncryptionKey)
    if (journalPayload) {
      const journalSession = await sessionStore.resolveJournalSession(journalPayload.sessionId)
      if (journalSession) {
        const conn = await connectionStore.findActiveConnection(journalSession.userId)
        if (conn?.encryptedRefreshToken) {
          refreshToken = decryptRefreshToken(conn.encryptedRefreshToken, config.tokenEncryptionKey)
        }
      }
    }
  }

  if (!refreshToken) {
    return jsonResponse({ error: 'unauthenticated' }, 401)
  }

  try {
    const { accessToken } = await refreshGoogleCredentials(refreshToken, config)
    const driveClient = new DriveClient()
    const candidates = await driveClient.listCandidateSpreadsheets(accessToken)
    return jsonResponse({ items: candidates })
  } catch {
    return jsonResponse({ error: 'upstream_failure' }, 502)
  }
}
