export type SheetProperties = {
  sheetId: number
  title: string
  gridProperties?: {
    rowCount?: number
    columnCount?: number
    frozenRowCount?: number
  }
}

export type SpreadsheetMetadata = {
  spreadsheetId: string
  properties: {
    title: string
    timeZone: string
  }
  sheets: Array<{
    properties: SheetProperties
  }>
}

export type ValueRange = {
  range: string
  values?: unknown[][]
}

export class SheetsClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getSpreadsheet(accessToken: string, spreadsheetId: string): Promise<SpreadsheetMetadata> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error('無法讀取 Google 試算表中繼資料。')
    }

    return (await response.json()) as SpreadsheetMetadata
  }

  async batchGet(accessToken: string, spreadsheetId: string, ranges: string[]): Promise<ValueRange[]> {
    const params = new URLSearchParams()
    for (const r of ranges) params.append('ranges', r)
    params.set('valueRenderOption', 'FORMATTED_VALUE')
    params.set('dateTimeRenderOption', 'FORMATTED_STRING')

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error('無法批次讀取 Google 試算表資料。')
    }

    const payload = (await response.json()) as { valueRanges?: ValueRange[] }
    return payload.valueRanges ?? []
  }

  async batchUpdateValues(
    accessToken: string,
    spreadsheetId: string,
    data: Array<{ range: string; values: unknown[][] }>,
  ): Promise<void> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: data.map((d) => ({ range: d.range, values: d.values })),
      }),
    })

    if (!response.ok) {
      throw new Error('無法更新 Google 試算表資料。')
    }
  }

  async batchUpdate(
    accessToken: string,
    spreadsheetId: string,
    requests: unknown[],
  ): Promise<void> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    })

    if (!response.ok) {
      throw new Error('無法更新 Google 試算表結構。')
    }
  }
}
