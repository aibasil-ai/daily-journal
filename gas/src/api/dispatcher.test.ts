import { describe, expect, it } from 'vitest'
import { executeAppRequest, toApiError } from './dispatcher'
import type { JournalService } from '../services/journal-service'

describe('GAS 分派器相容層', () => {
  it('維持 executeAppRequest 與 toApiError 的既有公開行為', () => {
    const service = {
      bootstrap: () => ({ timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] }),
    } as unknown as JournalService

    expect(executeAppRequest({ action: 'bootstrap' }, service)).toEqual({
      ok: true,
      data: { timezone: 'Asia/Taipei', categories: [], tagSuggestions: [] },
    })
    expect(toApiError(new Error('private detail'))).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '處理資料時發生錯誤，請稍後再試。',
    })
  })

  it('未知或無效請求不會提早建立 Apps Script 服務', () => {
    expect(executeAppRequest({ action: 'unknown' } as never)).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
      message: '不支援的操作。',
    })
    expect(executeAppRequest(null as never)).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
      message: '請檢查送出的資料格式後再試。',
    })
  })
})
