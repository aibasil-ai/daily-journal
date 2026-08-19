import { timingSafeEqual } from 'node:crypto'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response'
import { getServerConfig } from '../_lib/server-config'
import { getFirestoreClient } from '../_lib/firestore'
import { ConnectionStore } from '../_lib/connection-store'

export function GET(): Response {
  return methodNotAllowed('POST')
}

export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof getServerConfig>
  try {
    config = getServerConfig()
  } catch {
    return jsonResponse({ error: 'server_configuration_error' }, 500)
  }

  const body = (await request.json().catch(() => null)) as {
    secret?: string
    googleSub?: string
    spreadsheetId?: string
    spreadsheetName?: string
    createdByService?: boolean
  } | null

  const headerSecret = request.headers.get('X-Admin-Secret')
  const providedSecret = headerSecret || body?.secret || ''

  if (!isSecretValid(providedSecret, config.legacyMigrationSecret)) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const googleSub = body?.googleSub?.trim()
  const spreadsheetId = body?.spreadsheetId?.trim()
  if (!googleSub || !spreadsheetId) {
    return jsonResponse({ error: 'invalid_request', message: '請提供 googleSub 與 spreadsheetId' }, 400)
  }

  const firestore = getFirestoreClient()
  const connectionStore = new ConnectionStore(firestore)

  const user = await connectionStore.getUserByGoogleSub(googleSub)
  if (!user) {
    return jsonResponse({ error: 'user_not_found' }, 404)
  }

  try {
    const conn = await connectionStore.activateConnection({
      userId: user.id,
      spreadsheetId,
      spreadsheetName: body?.spreadsheetName?.trim() || '每日記事',
      encryptedRefreshToken: { ciphertext: 'legacy_unbound', keyVersion: config.tokenEncryptionKeyVersion },
      createdByService: body?.createdByService ?? false,
    })

    return jsonResponse({
      ok: true,
      connection: {
        userId: user.id,
        spreadsheetId: conn.spreadsheetId,
        spreadsheetName: conn.spreadsheetName,
      },
    })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'CLAIM_FAILED',
          message: error instanceof Error ? error.message : '舊 Sheet 綁定遷移失敗。',
        },
      },
      409,
    )
  }
}

function isSecretValid(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
}
