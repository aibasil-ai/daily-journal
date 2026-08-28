import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { CategoryColorMenu } from './category-color-menu'

afterEach(cleanup)

function renderMenu(selectedColor: '#b97c66' | null = null) {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <CategoryColorMenu
      selectedColor={selectedColor}
      position={{ x: 100, y: 100 }}
      restoreFocusTo={trigger}
      onSelect={onSelect}
      onClose={onClose}
    />,
  )
  return { trigger, onSelect, onClose }
}

test('顯示 24 個具選取狀態的可存取色票，並以鍵盤選色', async () => {
  const user = userEvent.setup()
  const { onSelect } = renderMenu()

  expect(screen.getByRole('menu', { name: '類別顏色' })).toBeInTheDocument()
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(24)
  expect(screen.getByRole('menuitemradio', { name: '預設' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: '預設' })).toHaveFocus()

  await user.keyboard('{End}{Enter}')
  expect(onSelect).toHaveBeenCalledWith('#c7c3c2')
})

test('方向鍵、Escape 與外部點擊遵循選單互動和焦點回復', async () => {
  const user = userEvent.setup()
  const { trigger, onClose } = renderMenu('#b97c66')
  const selected = screen.getByRole('menuitemradio', { name: '陶土' })

  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('menuitemradio', { name: '灰紅' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)

  fireEvent.pointerDown(document.body)
  expect(onClose).toHaveBeenCalledTimes(2)
  cleanup()
  expect(trigger).toHaveFocus()
  selected.remove()
})
