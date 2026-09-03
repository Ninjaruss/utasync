/**
 * Builds public/cmudict.json when missing (first clone / fresh install).
 * Downloads the CMU Pronouncing Dictionary — skipped when the output exists.
 *
 * Also rebuilds when the committed file is the old 15-word placeholder, so a
 * checkout predating the real lexicon self-heals instead of silently rendering
 * English readings as raw text.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'public/cmudict.json')

// The real lexicon is ~3.6MB; the placeholder it replaced was 351 bytes.
const MIN_REAL_BYTES = 1024 * 1024

if (existsSync(outPath) && statSync(outPath).size >= MIN_REAL_BYTES) {
  process.exit(0)
}

console.log('English pronunciation lexicon not found — building CMUdict (one-time)…')
const result = spawnSync(process.execPath, ['scripts/build-cmudict.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
