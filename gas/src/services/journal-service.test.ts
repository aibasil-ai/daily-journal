// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { JournalService } from './journal-service'
import { FakeJournalStore } from '../test/fake-journal-store'

describe('JournalService.bootstrap', () => {
  test('回傳試算表時區及啟用中的分類', () => {
    const store = new FakeJournalStore({
      timezone: 'Asia/Taipei',
      categories: [
        { id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
        { id: 'old', name: '舊分類', isActive: false, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' },
      ],
    })

    expect(new JournalService(store, () => '2026-08-04T00:00:00+08:00', () => 'uuid').bootstrap()).toEqual({
      timezone: 'Asia/Taipei',
      categories: [{ id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00' }],
      tagSuggestions: [],
    })
  })
})
