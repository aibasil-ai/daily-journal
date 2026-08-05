import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

test('relative Vite base 在 GitHub Pages 專案子路徑載入資源與設定檔', async () => {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })

  const html = await readFile('dist/index.html', 'utf8')
  const projectUrl = 'https://example.github.io/daily-journal/'
  const appConfigUrl = new URL(html.match(/src="(\.\/app-config\.js)"/)?.[1] ?? '', projectUrl)
  const scriptUrl = new URL(html.match(/src="(\.\/assets\/index-[\w-]+\.js)"/)?.[1] ?? '', projectUrl)
  const stylesheetUrl = new URL(html.match(/href="(\.\/assets\/index-[\w-]+\.css)"/)?.[1] ?? '', projectUrl)

  expect(appConfigUrl.pathname).toBe('/daily-journal/app-config.js')
  expect(scriptUrl.pathname).toMatch(/^\/daily-journal\/assets\/index-[\w-]+\.js$/)
  expect(stylesheetUrl.pathname).toMatch(/^\/daily-journal\/assets\/index-[\w-]+\.css$/)
})
