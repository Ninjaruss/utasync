/**
 * Builds public/jmdict-gloss.json when missing (first clone / fresh install).
 * Full build downloads JMdict — skipped when the output file already exists.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'public/jmdict-gloss.json')

if (existsSync(outPath)) {
  process.exit(0)
}

console.log('jmdict-gloss.json not found — building JMdict gloss lexicon (one-time)…')
const result = spawnSync(process.execPath, ['scripts/build-jmdict-gloss.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
