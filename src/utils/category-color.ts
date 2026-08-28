import type { CSSProperties } from 'react'
import type { CategoryColor } from '../domain/journal'

export type CategoryColorStyle = CSSProperties & {
  '--category-color': CategoryColor
}

export function categoryColorStyle(color: CategoryColor | null): CategoryColorStyle | undefined {
  return color === null ? undefined : { '--category-color': color }
}
