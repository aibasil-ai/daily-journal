export function createCsvBlob(headers: string[], rows: string[][]): Blob {
  const escape = (value: string) => `"${protectFormula(value).replaceAll('"', '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n'
  return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
}

export function downloadCsv(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function protectFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}
