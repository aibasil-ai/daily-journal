import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntryDetail } from './entry-detail'

describe('EntryDetail', () => {
  afterEach(() => {
    cleanup()
  })
  const mockEntry = {
    id: 'entry-1',
    entryDate: '2026-08-26',
    title: '研究&處理n8n主機替代方案',
    content: '將zeabur dev方案取消訂閱 9/21生效降為free\n愛託付匯出研究',
    categoryId: 'work',
    tags: ['ai', 'automation'],
    links: [
      {
        label: 'ChatGPT Work怎麼用？盤點14種上班族好用功能，如何打造超高效AI職場工作流？',
        url: 'https://today.line.me/tw/v3/article/8noGBpM',
      },
      {
        label: 'Suno AI 完整介紹：用文字做一首歌的 AI 音樂生成平台，功能、價格與創作者應用',
        url: 'https://rar.design/posts/suno-ai-music-generator-guide',
      },
    ],
    createdAt: '2026-08-26T21:00:00+08:00',
    updatedAt: '2026-08-26T21:00:00+08:00',
  }

  it('renders entry details and reference links with external target and rel attributes', () => {
    render(
      <EntryDetail
        entry={mockEntry}
        categoryName="工作"
        categoryColor={null}
        timezone="Asia/Taipei"
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '研究&處理n8n主機替代方案' })).toBeInTheDocument()
    expect(screen.getByText('工作')).toBeInTheDocument()
    expect(screen.getByText('#ai')).toBeInTheDocument()
    expect(screen.getByText('#automation')).toBeInTheDocument()

    const link1 = screen.getByRole('link', {
      name: /ChatGPT Work怎麼用？盤點14種上班族好用功能，如何打造超高效AI職場工作流？/i,
    })
    expect(link1).toHaveAttribute('href', 'https://today.line.me/tw/v3/article/8noGBpM')
    expect(link1).toHaveAttribute('target', '_blank')
    expect(link1).toHaveAttribute('rel', 'noreferrer noopener')

    const link2 = screen.getByRole('link', {
      name: /Suno AI 完整介紹：用文字做一首歌的 AI 音樂生成平台，功能、價格與創作者應用/i,
    })
    expect(link2).toHaveAttribute('href', 'https://rar.design/posts/suno-ai-music-generator-guide')
    expect(link2).toHaveAttribute('target', '_blank')
    expect(link2).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('handles back, edit and delete actions', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onEdit = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <EntryDetail
        entry={mockEntry}
        categoryName="工作"
        categoryColor={null}
        timezone="Asia/Taipei"
        onBack={onBack}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole('button', { name: '返回月曆' }))
    expect(onBack).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '編輯' }))
    expect(onEdit).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '刪除記事' }))
    expect(await screen.findByRole('dialog', { name: '刪除記事確認' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '永久刪除' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('uses the custom color on the category badge', () => {
    render(
      <EntryDetail
        entry={mockEntry}
        categoryName="工作"
        categoryColor="#b97c66"
        timezone="Asia/Taipei"
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('工作')).toHaveClass('category-badge--custom-color')
    expect(screen.getByText('工作')).toHaveStyle({ '--category-color': '#b97c66' })
  })
})
