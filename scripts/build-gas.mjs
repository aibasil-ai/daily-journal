import { appendFile, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

const outputDirectory = process.env.GAS_OUTPUT_DIR ?? 'gas-dist'
const codePath = join(outputDirectory, 'Code.js')

await mkdir(outputDirectory, { recursive: true })

await build({
  bundle: true,
  entryPoints: ['gas/src/index.ts'],
  format: 'iife',
  outfile: codePath,
  target: 'es2019',
})

await appendFile(codePath, `
function initializeJournal() {
  return globalThis.__dailyJournalInitializeJournal()
}

function executeAppRequest(request) {
  return globalThis.__dailyJournalExecuteAppRequest(request)
}
`)

await cp('gas/appsscript.json', join(outputDirectory, 'appsscript.json'))
