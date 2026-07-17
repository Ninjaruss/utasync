/**
 * Builds the reverse English→Japanese dictionary for the tap-lookup popover.
 * Source: jmdict-simplified (same cached file as build-jmdict-gloss.mjs).
 * Output: public/enja-dict.json — { v, source, entries: { enWord → [{w, r}] } }.
 * Lazy-loaded at runtime; only fetched when a user taps an English word.
 *
 * Usage: node scripts/build-enja-dict.mjs
 */
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reverseIndex } from './lib/enjaDict.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const cacheDir = join(root, '.cache/jmdict')
const outPath = join(root, 'public/enja-dict.json')

function sourceJson() {
  for (const name of ['jmdict-eng-3.6.2.json']) {
    const p = join(cacheDir, name)
    if (existsSync(p)) return p
  }
  throw new Error(`No jmdict JSON in ${cacheDir}. Run scripts/build-jmdict-gloss.mjs first (it downloads + extracts the source).`)
}

async function main() {
  const jsonPath = sourceJson()
  console.log(`Building enja-dict from ${jsonPath} ...`)
  const words = []
  const rl = createInterface({ input: createReadStream(jsonPath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let inWords = false
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!inWords) { if (trimmed.endsWith('"words": [')) inWords = true; continue }
    if (trimmed === ']' || trimmed === '],') break
    if (!trimmed.startsWith('{')) continue
    const jsonLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
    try { words.push(JSON.parse(jsonLine)) } catch { /* skip */ }
  }
  const entries = reverseIndex(words, { cap: 6 })
  const payload = JSON.stringify({ v: 1, source: 'jmdict-eng', entries })
  writeFileSync(outPath, payload)
  const mb = (Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)
  console.log(`Wrote ${outPath} (${mb} MB, ${Object.keys(entries).length} English keys)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
