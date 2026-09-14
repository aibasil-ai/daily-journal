import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarFrame } from './calendar-frame'

afterEach(cleanup)

const defaultProps = {
  mode: 'week' as const,
  anchorDate: '2026-09-03',
  entryCount: 4,
  isLoading: false,
  error: undefined,
  canMovePrevious: true,
  canMoveNext: true,
  onModeChange: vi.fn(),
  onMovePeriod: vi.fn(),
  onToday: vi.fn(),
  onRetry: vi.fn(),
}

describe('CalendarFrame', () => {
  it('顯示期間、計數與三段模式切換', async () => {
    const user = userEvent.setup()
    render(<CalendarFrame {...defaultProps}><p>週內容</p></CalendarFrame>)

    expect(screen.getByRole('heading', { name: '2026年8月31日－9月6日' })).toBeInTheDocument()
    expect(screen.getByText('本週共有 4 則記事')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '日曆檢視模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '日' }))
    expect(defaultProps.onModeChange).toHaveBeenCalledWith('day')
    expect(screen.getByRole('button', { name: '日' })).toHaveFocus()
  })

  it('依模式提供期間導覽並支援今天', async () => {
    const user = userEvent.setup()
    render(<CalendarFrame {...defaultProps}><p>週內容</p></CalendarFrame>)

    await user.click(screen.getByRole('button', { name: '上一週' }))
    await user.click(screen.getByRole('button', { name: '今天' }))
    await user.click(screen.getByRole('button', { name: '下一週' }))
    expect(defaultProps.onMovePeriod.mock.calls).toEqual([[-1], [1]])
    expect(defaultProps.onToday).toHaveBeenCalledOnce()
  })

  it('顯示模式切換並以 live region 播報期間標題', () => {
    render(<CalendarFrame {...defaultProps}><p>週內容</p></CalendarFrame>)

    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '週' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '2026年8月31日－9月6日' }).parentElement)
      .toHaveAttribute('aria-live', 'polite')
  })

  it('在互動日期邊界停用無法移動的方向', () => {
    render(
      <CalendarFrame {...defaultProps} canMovePrevious={false} canMoveNext={false}>
        <p>週內容</p>
      </CalendarFrame>,
    )

    expect(screen.getByRole('button', { name: '上一週' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一週' })).toBeDisabled()
  })

  it('在載入與錯誤狀態不顯示過期 children', async () => {
    const { rerender } = render(
      <CalendarFrame {...defaultProps} entryCount={null} isLoading><p>過期內容</p></CalendarFrame>,
    )
    expect(screen.getByRole('region', { name: '日曆內容' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('查詢中...')).toBeInTheDocument()
    expect(screen.queryByText('過期內容')).not.toBeInTheDocument()

    rerender(
      <CalendarFrame {...defaultProps} entryCount={null} error="載入失敗"><p>過期內容</p></CalendarFrame>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('載入失敗')
    await userEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(defaultProps.onRetry).toHaveBeenCalledOnce()
  })
})