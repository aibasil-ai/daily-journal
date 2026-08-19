export type CandidateSpreadsheet = {
  id: string
  name: string
  modifiedTime: string
}

export class DriveClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async listCandidateSpreadsheets(accessToken: string): Promise<CandidateSpreadsheet[]> {
    const q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '20',
    })
    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`

    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error('無法讀取 Google 雲端硬碟試算表列表。')
    }

    const payload = (await response.json()) as { files?: Array<{ id?: string; name?: string; modifiedTime?: string }> }
    const files = payload.files ?? []
    return files
      .filter((f): f is { id: string; name: string; modifiedTime: string } => Boolean(f.id && f.name && f.modifiedTime))
      .map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }))
  }

  async createSpreadsheet(accessToken: string, name: string): Promise<{ id: string; name: string }> {
    const response = await this.fetchImpl('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: name },
        sheets: [
          { properties: { title: 'entries' } },
          { properties: { title: 'categories' } },
          { properties: { title: 'settings' } },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error('無法在 Google 雲端硬碟建立新的試算表。')
    }

    const payload = (await response.json()) as { spreadsheetId: string; properties?: { title?: string } }
    return {
      id: payload.spreadsheetId,
      name: payload.properties?.title ?? name,
    }
  }
}