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
    'APP_ORIGIN',
    'SESSION_ENCRYPTION_KEY',
    'TOKEN_ENCRYPTION_KEY',
    'TOKEN_ENCRYPTION_KEY_VERSION',
    'FIRESTORE_PROJECT_ID',
    'FIRESTORE_SERVICE_ACCOUNT_JSON',
    'LEGACY_MIGRATION_SECRET',
    'CRON_SECRET',
  ])
  expect(keys).toHaveLength(10)
  expect(new Set(keys)).toHaveLength(10)
  expect(content).not.toMatch(/VITE_|SPREADSHEET_ID|ACCESS_TOKEN|REFRESH_TOKEN|GAS_DEPLOYMENT_ID/)
  expect(content).toMatch(/^LEGACY_MIGRATION_SECRET=$/m)
  expect(content).toMatch(/^CRON_SECRET=$/m)
  expect(content).not.toMatch(/(?:LEGACY_MIGRATION_SECRET|CRON_SECRET)=.+/)
})

test('前端不再嵌入 Google OAuth 設定，Vercel 以 filesystem-first 提供 API、SPA 與每日 cleanup cron', async () => {
  const [indexHtml, viteConfig, viteEnvironment, vercelConfig] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
    readFile('vercel.json', 'utf8'),
  ])

  expect(indexHtml).not.toMatch(/accounts\.google\.com\/gsi|app-config\.js/)
  expect(viteConfig).not.toMatch(/loadEnv|APP_GOOGLE_CLIENT_ID|APP_GAS_DEPLOYMENT_ID/)
  expect(viteEnvironment).not.toMatch(/JOURNAL_CONFIG|BUILD_JOURNAL_CONFIG/)
  expect(JSON.parse(vercelConfig)).toEqual({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    routes: [
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
    crons: [
      { path: '/api/internal/cleanup', schedule: '0 0 * * *' },
    ],
  })
  await expect(access('public/app-config.example.js')).rejects.toThrow()
})

test('部署與法務文件說明多使用者隔離、遷移與 Google Sheet 資料處理界線', async () => {
  const [readme, deployment, checklist, privacyPolicy, terms] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('docs/deployment.md', 'utf8'),
    readFile('docs/acceptance-checklist.md', 'utf8'),
    readFile('public/privacy-policy.html', 'utf8'),
    readFile('public/terms-of-service.html', 'utf8'),
  ])

  for (const content of [readme, deployment]) {
    expect(content).toContain('Firestore Native mode')
    expect(content).toContain('Cloud Datastore User')
    expect(content).toContain('Production 與 Preview')
    expect(content).toContain('LEGACY_MIGRATION_SECRET')
    expect(content).toContain('CRON_SECRET')
    expect(content).toContain('base64url')
    expect(content).toContain('至少 32 個字元')
    expect(content).toContain('randomBytes(32)')
    expect(content).toContain('不同')
    expect(content).toContain('0 0 * * *')
    expect(content).toContain('Hobby')
    expect(content).toContain('每日一次')
    expect(content).toContain('每小時精度')
    expect(content).toContain('Pro')
    expect(content).toContain('Enterprise')
  }
  expect(deployment).toContain('備份優先的舊 Sheet 遷移')
  expect(checklist).toContain('帳號 A')
  expect(checklist).toContain('自行連結的 Sheet')

  for (const content of [privacyPolicy, terms]) {
    expect(content).toContain('<html lang="zh-Hant">')
    expect(content).toContain('Google Sheet')
    expect(content).toContain('每日記事')
  }
  expect(privacyPolicy).toContain('refresh token')
  expect(terms).toContain('中央資料庫')
})
