import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Icon } from '../../components/icon'
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  type CategoryColor,
} from '../../domain/journal'
import { zhTW } from '../../i18n/zh-TW'

export type CategoryColorMenuProps = {
  selectedColor: CategoryColor | null
  position: Readonly<{ x: number; y: number }>
  restoreFocusTo: HTMLElement | null
  onSelect: (color: CategoryColor | null) => void
  onClose: () => void
}

const options: ReadonlyArray<CategoryColor | null> = [null, ...CATEGORY_COLORS]

type ColorOptionStyle = CSSProperties & { '--color-option': string }

export function CategoryColorMenu({
  selectedColor,
  position,
  restoreFocusTo,
  onSelect,
  onClose,
}: CategoryColorMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [menuPosition, setMenuPosition] = useState(position)
  const selectedIndex = Math.max(0, options.findIndex((color) => color === selectedColor))
  const [focusedIndex, setFocusedIndex] = useState(selectedIndex)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const margin = 8
    setMenuPosition({
      x: Math.max(margin, Math.min(position.x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(position.y, window.innerHeight - rect.height - margin)),
    })
  }, [position])

  useEffect(() => {
    const menu = menuRef.current
    menu?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
    const handlePointerDown = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) onCloseRef.current()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus()
    }
  }, [restoreFocusTo])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    else if (event.key === 'ArrowRight') nextIndex = (index + 1) % options.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + options.length) % options.length
    else if (event.key === 'ArrowDown') nextIndex = (index + columnCount()) % options.length
    else if (event.key === 'ArrowUp') nextIndex = (index - columnCount() + options.length) % options.length
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(options[index])
      return
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    } else return

    event.preventDefault()
    setFocusedIndex(nextIndex)
    menuRef.current?.querySelector<HTMLButtonElement>(`[data-color-index="${nextIndex}"]`)?.focus()
  }

  return (
    <div
      className="category-color-menu"
      ref={menuRef}
      role="menu"
      aria-labelledby="category-color-menu-title"
      style={{ left: menuPosition.x, top: menuPosition.y }}
    >
      <h2 id="category-color-menu-title">{zhTW.categoryColors.title}</h2>
      <div className="category-color-menu__grid">
        {options.map((color, index) => {
          const isSelected = color === selectedColor
          const label = color === null ? zhTW.categoryColors.names.default : zhTW.categoryColors.names[color]
          const optionStyle = { '--color-option': color ?? DEFAULT_CATEGORY_COLOR } as ColorOptionStyle
          return (
            <button
              className={`category-color-menu__option${isSelected ? ' category-color-menu__option--selected' : ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              aria-label={label}
              title={label}
              tabIndex={index === focusedIndex ? 0 : -1}
              data-color-index={index}
              key={color ?? 'default'}
              style={optionStyle}
              onClick={() => onSelect(color)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {isSelected && <Icon className="category-color-menu__check">check</Icon>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function columnCount(): number {
  if (window.innerWidth < 360) return 5
  if (window.innerWidth < 520) return 6
  return 8
}
