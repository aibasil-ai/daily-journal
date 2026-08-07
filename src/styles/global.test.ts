import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const globalStyles = readFileSync(new URL('./global.css', import.meta.url), 'utf8')

function ruleAfter(selector: string): string {
  const start = globalStyles.indexOf(selector)
  const end = globalStyles.indexOf('}', start)
  return start === -1 || end === -1 ? '' : globalStyles.slice(start, end)
}

test('行動版編輯 Dialog 維持置中且表單可捲動', () => {
  const dialogRule = globalStyles.match(/@media \(max-width: 767px\) \{[\s\S]*?\.entry-editor-dialog--edit\s*\{([^}]*)\}/)?.[1] ?? ''
  const formRule = ruleAfter('.entry-editor-dialog .entry-form')

  expect(dialogRule).toContain('width: calc(100% - 2rem)')
  expect(dialogRule).toContain('max-height: calc(100dvh - 2rem)')
  expect(dialogRule).toContain('border-radius: 0.75rem')
  expect(formRule).toContain('overflow-y: auto')
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

test('行動版聚焦閱讀與新增頁時隱藏全域導覽', () => {
  const mobileRules = globalStyles.slice(
    globalStyles.indexOf('@media (max-width: 767px)'),
    globalStyles.indexOf('@media (min-width: 600px)'),
  )

  expect(mobileRules).toContain('.journal-application:has(.entry-editor-dialog--create[open]) .app-navigation')
  expect(mobileRules).toContain('.journal-application:has(.entry-reader-dialog[open]) .app-navigation')
  expect(mobileRules).toContain('display: none')
})
