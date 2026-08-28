export const DEFAULT_CATEGORY_COLOR = '#d0e1fb'

export const CATEGORY_COLORS = [
  '#b97c66', '#d26865', '#fe382f', '#fe4f3c', '#ff703d',
  '#ffa84b', '#ffcb65', '#ffe784', '#b0da64', '#60c844',
  '#19a76a', '#46cc9b', '#93d5bb', '#93d4d9', '#a6c9e4',
  '#4b86df', '#8f91f1', '#b091ef', '#9b70d8', '#ca64db',
  '#eb7c9c', '#c6a6a7', '#c7c3c2',
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]

const categoryColorSet = new Set<string>(CATEGORY_COLORS)

export function normalizeCategoryColor(value: string): CategoryColor | undefined {
  const normalized = value.trim().toLowerCase()
  return categoryColorSet.has(normalized) ? normalized as CategoryColor : undefined
}
