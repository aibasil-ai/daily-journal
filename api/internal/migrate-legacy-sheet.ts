import { getFirestoreClient } from '../_lib/firestore.js'
import { jsonResponse, methodNotAllowed } from '../_lib/function-response.js'
import {
  createServerLegacyMigrationDependencies,
  hasExpectedBearerSecret,
  LegacyMigrationError,
  parseLegacyMigrationInput,
  runLegacyMigration,
  type LegacyMigrationInput,
} from '../_lib/legacy-migration.js'
import { getServerConfig, type ServerConfig } from '../_lib/server-config.js'

export type LegacyMigrationHandlerDependencies = {
  config: Pick<ServerConfig, 'legacyMigrationSecret'>
  migrate(input: LegacyMigrationInput): Promise<void>
}

/** 只供備份後的受保護管理程序呼叫，不能以一般網站 session 執行。 */
export function createLegacyMigrationHandler(
  dependencies: LegacyMigrationHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (!hasExpectedBearerSecret(request, dependencies.config.legacyMigrationSecret)) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
    if (!isJsonRequest(request)) return jsonResponse({ error: 'unsupported_media_type' }, 415)

    const input = await readMigrationInput(request)
    if (!input) return jsonResponse({ error: 'invalid_request' }, 400)

    try {
      await dependencies.migrate(input)
      return jsonResponse({ migrated: true })
    } catch (error) {
      if (error instanceof LegacyMigrationError) {
        return jsonResponse({ error: error.code }, error.status)
      }
      return jsonResponse({ error: 'migration_unavailable' }, 503)
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const config = getServerConfig()
  if (!hasExpectedBearerSecret(request, config.legacyMigrationSecret)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const firestore = getFirestoreClient()
  return createLegacyMigrationHandler({
    config,
    migrate: (input) => runLegacyMigration(input, createServerLegacyMigrationDependencies(config, firestore)),
  })(request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readMigrationInput(request: Request): Promise<LegacyMigrationInput | undefined> {
  try {
    const parsed = parseLegacyMigrationInput(await request.json())
    return parsed && { googleSub: parsed.googleSub, sheetUrl: parsed.sheetUrl }
  } catch {
    return undefined
  }
}
