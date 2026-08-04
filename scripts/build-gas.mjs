import { cp, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir('gas-dist', { recursive: true })

await build({
  bundle: true,
  entryPoints: ['gas/src/index.ts'],
  format: 'iife',
  outfile: 'gas-dist/Code.js',
  target: 'es2019',
})

await cp('gas/appsscript.json', 'gas-dist/appsscript.json')
