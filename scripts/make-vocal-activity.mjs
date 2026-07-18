/**
 * Derive a committed vocal-activity envelope fixture from a local MP3.
 * The output is a lossy energy curve (NOT the audio) → not a copyrighted
 * reproduction. Run once per corpus song you have locally (via tsx, since it
 * imports the TS DSP module):
 *   npx tsx scripts/make-vocal-activity.mjs <input.mp3> <song-name> [--stem]
 * Writes tests/ai-pipeline/fixtures/vocal-activity/<song-name>.json.
 * Use --stem only if <input.mp3> is already a Demucs vocal isolate.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const [input, name] = process.argv.slice(2)
const source = process.argv.includes('--stem') ? 'stem' : 'mix'
if (!input || !name) { console.error('usage: npx tsx scripts/make-vocal-activity.mjs <input.mp3> <song-name> [--stem]'); process.exit(1) }

const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { computeVocalActivity } = await import(pathToFileURL(join(root, 'src/ai-pipeline/vocalActivity.ts')).href)

const { data, sampleRate } = await decodeMp3ToMono(input)
const sig = computeVocalActivity(data, sampleRate, { source })
const outDir = join(root, 'tests/ai-pipeline/fixtures/vocal-activity')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `${name}.json`)
// Store as plain arrays (round to 3dp to keep the file small + stable).
const round = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000)
writeFileSync(out, JSON.stringify({ hopSec: sig.hopSec, source: sig.source, activity: round(sig.activity), onset: round(sig.onset) }))
console.log(`Wrote ${out} (${sig.activity.length} frames @ ${sig.hopSec.toFixed(4)}s, source=${sig.source})`)
