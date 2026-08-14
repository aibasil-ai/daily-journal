import { build } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'

await mkdir('gas-dist', { recursive: true })

await build({
  entryPoints: ['gas/src/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  outfile: 'gas-dist/Code.js',
  logLevel: 'info',
})

await cp('gas/appsscript.json', 'gas-dist/appsscript.json')
