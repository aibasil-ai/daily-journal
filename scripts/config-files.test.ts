import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('環境變數範例只含公開設定鍵', async () => {
  const content = await readFile('.env.example', 'utf8')
  expect(content).toContain('APP_GOOGLE_CLIENT_ID=')
  expect(content).toContain('APP_GAS_DEPLOYMENT_ID=')
  expect(content).not.toMatch(/SPREADSHEET_ID|CLIENT_SECRET|ACCESS_TOKEN/)
})
