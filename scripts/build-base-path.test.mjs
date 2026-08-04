import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

describe('production build base path', () => {
  test('uses APP_BASE_PATH for assets and runtime configuration', async () => {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: process.cwd(),
      env: { ...process.env, APP_BASE_PATH: '/daily-journal' },
      stdio: 'pipe',
    })

    const html = await readFile('dist/index.html', 'utf8')

    expect(html).toContain('src="./app-config.js"')
    expect(html).toMatch(/src="\/daily-journal\/assets\/index-[\w-]+\.js"/)
    expect(html).toMatch(/href="\/daily-journal\/assets\/index-[\w-]+\.css"/)
  })
})
