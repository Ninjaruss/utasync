/**
 * Builds public/jmdict-gloss.json + public/jmdict-readings.json when missing
 * (first clone / fresh install). Full build downloads JMdict — skipped when
 * both output files already exist.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'public/jmdict-gloss.json')
const readingsOutPath = join(root, 'public/jmdict-readings.json')

if (existsSync(outPath) && existsSync(readingsOutPath)) {
  process.exit(0)
}

console.log('JMdict gloss/readings data not found — building JMdict lexicon (one-time)…')
const result = spawnSync(process.execPath, ['scripts/build-jmdict-gloss.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
