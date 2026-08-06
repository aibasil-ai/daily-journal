import { readFile } from 'node:fs/promises'

test('設定檔不會保留瀏覽器端 OAuth 或 GAS 設定', async () => {
  const [envExample, indexHtml, viteConfig] = await Promise.all([
    readFile('.env.example', 'utf8'),
    readFile('index.html', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
  ])

  expect(indexHtml).not.toMatch(/\bGIS\b|accounts\.google\.com\/gsi|google\.accounts\.id/iu)
  expect(indexHtml).not.toContain('app-config')
  expect(viteConfig).not.toMatch(/\bloadEnv\b|\bAPP_GOOGLE_CLIENT_ID\b|\bAPP_GAS_DEPLOYMENT_ID\b/)
  expect(viteConfig).not.toContain('app-config')
  expect(envExample).not.toMatch(/APP_GOOGLE_CLIENT_ID|APP_GAS_DEPLOYMENT_ID|SPREADSHEET_ID|ACCESS_TOKEN|REFRESH_TOKEN/)

  const settings = envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  expect(settings).toEqual([
    'GOOGLE_CLIENT_ID=',
    'GOOGLE_CLIENT_SECRET=',
    'SESSION_ENCRYPTION_KEY=',
    'GAS_DEPLOYMENT_ID=',
  ])
  expect(settings.every((line) => /^[A-Z][A-Z0-9_]*=$/.test(line))).toBe(true)
})

test('Vercel 先解析 filesystem API 路由，再以 SPA fallback 回應前端路徑', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    $schema: string
    routes: { handle?: string; src?: string; dest?: string }[]
  }

  expect(config.$schema).toBe('https://openapi.vercel.sh/vercel.json')
  const filesystemRouteIndex = config.routes.findIndex((route) => route.handle === 'filesystem')
  const spaFallbackRouteIndex = config.routes.findIndex((route) => (
    route.src === '/(.*)' && route.dest === '/index.html'
  ))

  expect(filesystemRouteIndex).toBeGreaterThanOrEqual(0)
  expect(spaFallbackRouteIndex).toBeGreaterThanOrEqual(0)
  expect(filesystemRouteIndex).toBeLessThan(spaFallbackRouteIndex)
})
