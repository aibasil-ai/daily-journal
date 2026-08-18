import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CategoryManager } from './category-manager'

afterEach(cleanup)

test('點選新增類別會開啟類別名稱表單', async () => {
  const user = userEvent.setup()
  render(
    <CategoryManager
      categories={[{
        id: 'work',
        name: '工作',
        isActive: true,
        createdAt: '2026-08-04T00:00:00+08:00',
        updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      entryCounts={new Map()}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onDeactivate={vi.fn().mockResolvedValue(undefined)}
    />,
  )

  await user.click(screen.getByRole('button', { name: '新增類別' }))

  expect(screen.getByRole('region', { name: '新增類別' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '類別名稱' })).toHaveFocus()
})
