import { access, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('環境變數範例只含 server-only 設定鍵', async () => {
  const content = await readFile('.env.example', 'utf8')
  const keys = content
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
    .filter((key): key is string => Boolean(key))

  expect(keys).toEqual([
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'SESSION_ENCRYPTION_KEY',
    'GAS_DEPLOYMENT_ID',
  ])
  expect(content).not.toMatch(/APP_|SPREADSHEET_ID|ACCESS_TOKEN|REFRESH_TOKEN/)
})

test('前端不再嵌入 Google OAuth 設定，Vercel 提供 SPA fallback', async () => {
  const [indexHtml, viteConfig, viteEnvironment, vercelConfig] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
    readFile('vercel.json', 'utf8'),
  ])

  expect(indexHtml).not.toMatch(/accounts\.google\.com\/gsi|app-config\.js/)
  expect(viteConfig).not.toMatch(/loadEnv|APP_GOOGLE_CLIENT_ID|APP_GAS_DEPLOYMENT_ID/)
  expect(viteEnvironment).not.toMatch(/JOURNAL_CONFIG|BUILD_JOURNAL_CONFIG/)
  expect(JSON.parse(vercelConfig)).toMatchObject({
    routes: [
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  })
  await expect(access('public/app-config.example.js')).rejects.toThrow()
})
