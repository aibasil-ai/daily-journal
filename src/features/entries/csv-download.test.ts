// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
import { createCsvBlob, downloadCsv } from './csv-download'

test('CSV 使用 UTF-8 BOM、全欄引號並跳脫逗號與雙引號', async () => {
  const bytes = new Uint8Array(await readBlob(createCsvBlob(['標題', '內容'], [['含,逗號', '包含 "引號"']])))

  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(new TextDecoder().decode(bytes.slice(3))).toBe('"標題","內容"\r\n"含,逗號","包含 ""引號"""\r\n')
})

test.each([
  ['=', '=SUM(A1)', "'=SUM(A1)"],
  ['+', '+SUM(A1)', "'+SUM(A1)"],
  ['-', '-SUM(A1)', "'-SUM(A1)"],
  ['@', '@SUM(A1)', "'@SUM(A1)"],
])('CSV 將 %s 開頭的標頭與資料欄位轉為純文字', async (_prefix, value, expected) => {
  const text = await readCsv(createCsvBlob([value], [[value]]))

  expect(text).toBe(`"${expected}"\r\n"${expected}"\r\n`)
})

test('CSV 將正常負數視為文字，並保留非公式開頭的說明文案', async () => {
  const text = await readCsv(createCsvBlob(['金額', '說明'], [['-42', '負數為 -42']]))

  expect(text).toBe('"金額","說明"\r\n"\'-42","負數為 -42"\r\n')
})

test('下載使用瀏覽器本地日期的指定檔名', () => {
  const createObjectURL = vi.fn(() => 'blob:csv')
  const revokeObjectURL = vi.fn()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
    expect(this.download).toBe('daily-journal-2026-08-04.csv')
    expect(this.href).toBe('blob:csv')
  })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

  downloadCsv(['標題'], [['記事']], new Date(2026, 7, 4, 12))

  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  expect(click).toHaveBeenCalledOnce()
})

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsArrayBuffer(blob)
  })
}

async function readCsv(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBlob(blob))
  return new TextDecoder().decode(bytes.slice(3))
}
