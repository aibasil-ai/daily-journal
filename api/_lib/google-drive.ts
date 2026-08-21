const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'

/** 需要重新授權或重新選擇資料表的 Google 連線錯誤。 */
export class GoogleConnectionError extends Error {
  constructor() {
    super('無法存取 Google 資料，請重新連線後再試。')
    this.name = 'GoogleConnectionError'
  }
}

/** 可安全重試的 Google 上游服務錯誤。 */
export class GoogleUpstreamError extends Error {
  constructor() {
    super('Google 服務暫時無法使用，請稍後再試。')
    this.name = 'GoogleUpstreamError'
  }
}

export type GoogleSpreadsheetReference = {
  id: string
  name: string
  modifiedTime: string
}

export type GoogleSpreadsheetPage = {
  items: GoogleSpreadsheetReference[]
  nextPageToken?: string
}

/** 僅供伺服器端連線資料傳入的系統建立 Sheet 識別資訊。 */
export type SystemCreatedSpreadsheetConnection = {
  spreadsheetId: string
  createdByService: boolean
}

type DriveFile = {
  id?: unknown
  name?: unknown
  modifiedTime?: unknown
  mimeType?: unknown
  trashed?: unknown
  ownedByMe?: unknown
  shared?: unknown
  capabilities?: {
    canEdit?: unknown
  }
}

/** Google Drive v3 的最小伺服器端存取封裝。 */
export class GoogleDriveClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async listOwnedSpreadsheets(accessToken: string, pageToken?: string): Promise<GoogleSpreadsheetPage> {
    const params = new URLSearchParams({
      q: `mimeType='${GOOGLE_SHEETS_MIME_TYPE}' and trashed=false and 'me' in owners`,
      fields: 'nextPageToken,files(id,name,modifiedTime,mimeType,trashed,ownedByMe,shared,capabilities(canEdit))',
      corpora: 'user',
      orderBy: 'modifiedTime desc',
      pageSize: '20',
      spaces: 'drive',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const response = await this.request(`${DRIVE_FILES_URL}?${params.toString()}`, accessToken)
    const payload = await readRecord(response)
    const files = Array.isArray(payload.files) ? payload.files : []
    const items = files
      .map(toEligibleSpreadsheet)
      .filter((file): file is GoogleSpreadsheetReference => file !== undefined)

    const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken
      ? payload.nextPageToken
      : undefined
    return { items, ...(nextPageToken ? { nextPageToken } : {}) }
  }

  async getOwnedSpreadsheet(accessToken: string, spreadsheetId: string): Promise<GoogleSpreadsheetReference> {
    const normalizedId = spreadsheetId.trim()
    if (!normalizedId) throw new GoogleConnectionError()

    const fields = 'id,name,modifiedTime,mimeType,trashed,ownedByMe,shared,capabilities(canEdit)'
    const url = `${DRIVE_FILES_URL}/${encodeURIComponent(normalizedId)}?${new URLSearchParams({ fields }).toString()}`
    const response = await this.request(url, accessToken)
    const file = toEligibleSpreadsheet(await readRecord(response))
    if (!file || file.id !== normalizedId) throw new GoogleConnectionError()
    return file
  }

  /** 保留既有呼叫端使用的名稱。 */
  async listSpreadsheets(accessToken: string, pageToken?: string): Promise<GoogleSpreadsheetPage> {
    return this.listOwnedSpreadsheets(accessToken, pageToken)
  }

  /** 保留既有呼叫端使用的名稱。 */
  async verifySpreadsheet(accessToken: string, spreadsheetId: string): Promise<GoogleSpreadsheetReference> {
    return this.getOwnedSpreadsheet(accessToken, spreadsheetId)
  }

  async deleteSystemCreatedSpreadsheet(
    accessToken: string,
    connection: SystemCreatedSpreadsheetConnection,
  ): Promise<void> {
    if (!isSystemCreatedSpreadsheetConnection(connection)) throw new GoogleConnectionError()
    const spreadsheetId = connection.spreadsheetId.trim()
    await this.request(
      `${DRIVE_FILES_URL}/${encodeURIComponent(spreadsheetId)}`,
      accessToken,
      'DELETE',
    )
  }

  private async request(url: string, accessToken: string, method?: 'DELETE'): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...(method ? { method } : {}),
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new GoogleUpstreamError()
    }
    if (!response.ok) throw toGoogleApiError(response.status)
    return response
  }
}

/** 將 Google HTTP 狀態碼轉為不含上游細節的錯誤。 */
export function toGoogleApiError(status: number): GoogleConnectionError | GoogleUpstreamError {
  if (status === 401 || status === 403 || status === 404) return new GoogleConnectionError()
  return new GoogleUpstreamError()
}

function toEligibleSpreadsheet(value: unknown): GoogleSpreadsheetReference | undefined {
  if (!isRecord(value)) return undefined
  const file = value as DriveFile
  if (
    typeof file.id !== 'string'
    || !file.id
    || typeof file.name !== 'string'
    || typeof file.modifiedTime !== 'string'
    || file.mimeType !== GOOGLE_SHEETS_MIME_TYPE
    || file.trashed !== false
    || file.ownedByMe !== true
    || file.shared !== false
    || !isRecord(file.capabilities)
    || file.capabilities.canEdit !== true
  ) {
    return undefined
  }
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime }
}

function isSystemCreatedSpreadsheetConnection(
  value: unknown,
): value is SystemCreatedSpreadsheetConnection {
  return isRecord(value)
    && value.createdByService === true
    && typeof value.spreadsheetId === 'string'
    && Boolean(value.spreadsheetId.trim())
}

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) return value
  } catch {
    // Malformed upstream payloads are treated as safely retryable failures.
  }
  throw new GoogleUpstreamError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
