import { execFileSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'

test('GAS bundle 在 IIFE 後附加可偵測的頂層 wrapper', async () => {
  const codePath = 'gas-dist/Code.js'
  const manifestPath = 'gas-dist/appsscript.json'
  const originalCode = await readOptional(codePath)
  const originalManifest = await readOptional(manifestPath)

  try {
    execFileSync(process.execPath, ['scripts/build-gas.mjs'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })

    const code = await readFile(codePath, 'utf8')
    const iifeEnd = code.lastIndexOf('})();')
    const initializeWrapper = '\nfunction initializeJournal() {\n  return globalThis.__dailyJournalInitializeJournal()\n}'
    const executeWrapper = '\nfunction executeAppRequest(request) {\n  return globalThis.__dailyJournalExecuteAppRequest(request)\n}'

    expect(iifeEnd).toBeGreaterThan(-1)
    expect(code.indexOf(initializeWrapper)).toBeGreaterThan(iifeEnd)
    expect(code.indexOf(executeWrapper)).toBeGreaterThan(iifeEnd)
  } finally {
    await restore(codePath, originalCode)
    await restore(manifestPath, originalManifest)
  }
})

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function restore(path: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true })
    return
  }
  await writeFile(path, content)
}
