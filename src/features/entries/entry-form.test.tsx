import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { EntryForm } from './entry-form'

test('提交含標籤與連結的記事', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <EntryForm
      categories={[{
        id: 'work', name: '工作', isActive: true, createdAt: '2026-08-04T00:00:00+08:00', updatedAt: '2026-08-04T00:00:00+08:00',
      }]}
      tagSuggestions={['會議']}
      timezone="Asia/Taipei"
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  )

  await user.type(screen.getByLabelText('記事內容'), '完成週會紀錄')
  await user.selectOptions(screen.getByLabelText('分類'), 'work')
  await user.type(screen.getByLabelText('標籤'), '會議{Enter}專案A{Enter}')
  await user.click(screen.getByRole('button', { name: '新增連結' }))
  await user.type(screen.getByLabelText('連結名稱 1'), '會議紀錄')
  await user.type(screen.getByLabelText('連結網址 1'), 'https://example.com/meeting')
  await user.click(screen.getByRole('button', { name: '儲存記事' }))

  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    categoryId: 'work',
    tags: ['會議', '專案A'],
    links: [{ label: '會議紀錄', url: 'https://example.com/meeting' }],
  })))
})
