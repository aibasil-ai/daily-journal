export type CsvExport = {
  headers: string[]
  rows: string[][]
}

export function createCsvBlob(headers: string[], rows: string[][]): Blob {
  const escape = (value: string) => `"${(startsWithFormula(value) ? `'${value}` : value).replaceAll('"', '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n'
  return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
}

function startsWithFormula(value: string): boolean {
  return /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value)
}

export function downloadCsv(headers: string[], rows: string[][], date = new Date()) {
  const link = document.createElement('a')
  const objectUrl = URL.createObjectURL(createCsvBlob(headers, rows))
  link.href = objectUrl
  link.download = `daily-journal-${localDate(date)}.csv`
  link.click()
  URL.revokeObjectURL(objectUrl)
}

function localDate(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 10)
}
