import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

test('Vercel 兩層 SPA 深連結使用根目錄前端資源', async () => {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })

  const html = await readFile('dist/index.html', 'utf8')
  const nestedSpaUrl = 'https://journal.example/entries/2026-08-06'
  const scriptPath = html.match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1] ?? ''
  const stylesheetPath = html.match(/href="(\/assets\/index-[\w-]+\.css)"/)?.[1] ?? ''

  expect(html).not.toContain('app-config.js')
  expect(scriptPath).toMatch(/^\/assets\/index-[\w-]+\.js$/)
  expect(stylesheetPath).toMatch(/^\/assets\/index-[\w-]+\.css$/)
  expect(new URL(scriptPath, nestedSpaUrl).pathname).toBe(scriptPath)
  expect(new URL(stylesheetPath, nestedSpaUrl).pathname).toBe(stylesheetPath)
})
