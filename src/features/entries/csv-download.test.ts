import { expect, test } from 'vitest'
import { createCsvBlob } from './csv-download'

test('CSV 使用 UTF-8 BOM 並跳脫雙引號', async () => {
  const bytes = new Uint8Array(await readBlobBytes(createCsvBlob(['標題'], [['包含 "引號"']])))
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(new TextDecoder().decode(bytes.slice(3))).toBe('"標題"\r\n"包含 ""引號"""\r\n')
})

test('CSV 避免以公式字首開頭的記事內容被試算表執行', async () => {
  const bytes = new Uint8Array(await readBlobBytes(createCsvBlob(['內容'], [['=SUM(A1:A2)']])))
  expect(new TextDecoder().decode(bytes.slice(3))).toContain("'=SUM(A1:A2)")
})

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsArrayBuffer(blob)
  })
}
