import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

test('GAS bundle 產生 Apps Script 可辨識的頂層入口函式', async () => {
  await execFileAsync(process.execPath, ['scripts/build-gas.mjs'])

  const bundle = await readFile('gas-dist/Code.js', 'utf8')

  expect(bundle).toMatch(
    /function executeAppRequest\(request\) \{\r?\n {2}return JournalApp\.executeAppRequest\(request\)\r?\n\}/,
  )
  expect(bundle).toMatch(
    /function initializeJournal\(\) \{\r?\n {2}return JournalApp\.initializeJournal\(\)\r?\n\}/,
  )
})
