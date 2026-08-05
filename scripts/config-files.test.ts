import { readFile } from 'node:fs/promises'

test('環境變數範例只含公開設定鍵', async () => {
  const content = await readFile('.env.example', 'utf8')

  expect(content).toContain('APP_GOOGLE_CLIENT_ID=')
  expect(content).toContain('APP_GAS_SCRIPT_ID=')
  expect(content).not.toMatch(/SPREADSHEET_ID|CLIENT_SECRET|ACCESS_TOKEN/)
  expect(content).not.toContain('APP_BASE_PATH=')
})
