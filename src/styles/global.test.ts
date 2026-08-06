import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const globalStyles = readFileSync(new URL('./global.css', import.meta.url), 'utf8')

function ruleAfter(selector: string): string {
  const start = globalStyles.indexOf(selector)
  const end = globalStyles.indexOf('}', start)
  return start === -1 || end === -1 ? '' : globalStyles.slice(start, end)
}

test('行動版編輯 Dialog 使用可捲動的全螢幕版面', () => {
  const rule = globalStyles.match(/@media \(max-width: 767px\) \{[\s\S]*?\.entry-editor-dialog\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(rule).toContain('width: 100vw')
  expect(rule).toContain('max-width: none')
  expect(rule).toContain('height: 100dvh')
  expect(rule).toContain('max-height: none')
  expect(rule).toContain('margin: 0')
  expect(rule).toContain('border-radius: 0')
  expect(rule).toContain('overflow-y: auto')
})

test('記事操作控制項保留至少 44px 的觸控高度', () => {
  const textActionRule = ruleAfter('.tag-list__remove')
  const readActionRule = ruleAfter('.entry-card__read {')
  const cardActionRule = ruleAfter('.entry-card__actions button')

  expect(textActionRule).toContain('min-height: 2.75rem')
  expect(readActionRule).toContain('min-height: 2.75rem')
  expect(cardActionRule).toContain('min-height: 2.75rem')
  expect(cardActionRule).toContain('flex-shrink: 0')
})
