// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
import { createCsvBlob, downloadCsv } from './csv-download'

test('CSV 使用 UTF-8 BOM、全欄引號並跳脫逗號與雙引號', async () => {
  const bytes = new Uint8Array(await readBlob(createCsvBlob(['標題', '內容'], [['含,逗號', '包含 "引號"']])))

  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(new TextDecoder().decode(bytes.slice(3))).toBe('"標題","內容"\r\n"含,逗號","包含 ""引號"""\r\n')
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
