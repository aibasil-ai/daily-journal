import { expect, test } from 'vitest'
import type { ApiRequest } from './journal'

const createCategoryRequest: ApiRequest = { action: 'saveCategory', category: { name: '工作' } }
const updateCategoryRequest: ApiRequest = { action: 'saveCategory', category: { id: 'work', name: '工作' } }

test('saveCategory 請求支援新增與更新分類', () => {
  expect([createCategoryRequest, updateCategoryRequest]).toEqual([
    { action: 'saveCategory', category: { name: '工作' } },
    { action: 'saveCategory', category: { id: 'work', name: '工作' } },
  ])
})
