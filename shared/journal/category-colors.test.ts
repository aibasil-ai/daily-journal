import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategoryColor,
} from './category-colors.js'

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left)
  const second = relativeLuminance(right)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('類別色票', () => {
  it('只提供 23 個唯一且安全的自訂色', () => {
    expect(CATEGORY_COLORS).toHaveLength(23)
    expect(new Set(CATEGORY_COLORS).size).toBe(23)
    expect(CATEGORY_COLORS).not.toContain('#414646')
    for (const color of CATEGORY_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastRatio(color, '#191c1e')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('保留既有淺藍作為預設色票預覽', () => {
    expect(DEFAULT_CATEGORY_COLOR).toBe('#d0e1fb')
  })

  it('只正規化白名單中的色碼', () => {
    expect(normalizeCategoryColor(' #B97C66 ')).toBe('#b97c66')
    expect(normalizeCategoryColor('#414646')).toBeUndefined()
    expect(normalizeCategoryColor('#ffffff')).toBeUndefined()
  })
})
