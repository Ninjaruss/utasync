/**
 * Line-pairing scorecard. Perturbs the ENGLISH side of each clean 1:1 corpus
 * fixture the way real fan translations differ, then scores what the fitter
 * recovers. Truth is known by construction.
 *
 * The committed fixtures are all exactly line-parallel (veil 48/48, akfg 30/30,
 * guitar 47/47), so the existing pairing ratchet only ever exercises the case
 * that already works. This is the instrument for the case that does not.
 *
 * Run:
 *   npx tsx scripts/audit-line-pairing.mjs
 *   npx tsx scripts/audit-line-pairing.mjs --write-baseline
 *   npx tsx scripts/audit-line-pairing.mjs --check-baseline
 *
 * Lower is better for line_wrong / line_missing / lines_lost; higher for
 * line_correct / flag_precision / flag_recall.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCachedEmbedTexts } from './lib/cachedEmbedder.mjs'
import { scoreLinePairing, mapRowsToOriginals } from './lib/linePairingScore.mjs'
import { identity, truthStrings } from './lib/translationPerturbations.mjs'
import { PERTURBATIONS } from './lib/linePairingCorpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const BASELINE = join(FIXTURES, 'line-pairing-baseline.json')

const WRITE_BASELINE = process.argv.includes('--write-baseline')
const CHECK_BASELINE = process.argv.includes('--check-baseline')
const WRITE_EMBED_CACHE = process.argv.includes('--write-embed-cache')

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  const { smartAttachSecondLanguage } = await import(
    pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href
  )

  let fallback = null
  if (WRITE_EMBED_CACHE) {
    // src/ai-pipeline/textEmbedder.ts requires a browser Worker, unavailable
    // under Node. Mirror audit-corpus.mjs's --pairing path: use the
    // Node-compatible direct loader of the same model instead.
    const mod = await import(pathToFileURL(join(root, 'scripts/lib/nodeEmbedder.mjs')).href)
    fallback = mod.embedTexts
  }
  const { embedTexts, flush } = createCachedEmbedTexts({
    cachePath: join(FIXTURES, 'embeddings-cache.json'),
    fallback,
  })

  const songs = corpus.songs.filter((s) => s.en)
  const rows = []

  for (const song of songs) {
    const originals = readLines(join(FIXTURES, song.lyrics))
    const translations = readLines(join(FIXTURES, song.en))

    for (const p of PERTURBATIONS) {
      const state = p.apply(identity(translations), originals)
      // TIMED primary (ruling F1): the realistic case, and the only one that
      // reaches finalizeTimedAttach, where the extras-dropping bug lives.
      // Timestamps are synthetic but ordered and non-zero.
      const primary = originals.map((original, i) => ({
        startTime: i * 2, endTime: i * 2 + 2, original, translation: '',
      }))

      const result = await smartAttachSecondLanguage(
        primary,
        state.lines.join('\n'),
        embedTexts,
      )
      const { assigned, flagged } = mapRowsToOriginals(originals, result.lines)
      const m = scoreLinePairing(truthStrings(state), assigned, state.lines, flagged)

      rows.push({ song: song.name, perturbation: p.name, n: originals.length, ...m })
    }
  }

  const fmt = (v) => (v == null ? '-' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v))
  for (const r of rows) {
    console.log(
      `${r.song.padEnd(24)} ${r.perturbation.padEnd(16)} ` +
      `ok ${fmt(r.line_correct).padStart(3)}  wrong ${fmt(r.line_wrong).padStart(3)}  ` +
      `missing ${fmt(r.line_missing).padStart(3)}  lost ${fmt(r.lines_lost).padStart(3)}  ` +
      `flagP ${fmt(r.flag_precision).padStart(5)}  flagR ${fmt(r.flag_recall).padStart(5)}`,
    )
  }

  if (WRITE_EMBED_CACHE && flush()) console.log('\nEmbedding cache written.')

  if (WRITE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(rows, null, 2) + '\n')
    console.log(`\nBaseline written to ${BASELINE}`)
  }

  if (CHECK_BASELINE) {
    if (!existsSync(BASELINE)) throw new Error('No baseline; run --write-baseline first.')
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const key = (r) => `${r.song}::${r.perturbation}`
    const byKey = new Map(base.map((r) => [key(r), r]))
    let failed = false
    for (const r of rows) {
      const b = byKey.get(key(r))
      if (!b) { console.error(`NEW ROW ${key(r)}`); failed = true; continue }
      for (const metric of ['line_wrong', 'line_missing', 'lines_lost']) {
        if (r[metric] > b[metric]) {
          console.error(`REGRESSION ${key(r)} ${metric}: ${b[metric]} -> ${r[metric]}`)
          failed = true
        }
      }
      if (r.line_correct < b.line_correct) {
        console.error(`REGRESSION ${key(r)} line_correct: ${b.line_correct} -> ${r.line_correct}`)
        failed = true
      }
    }
    if (failed) process.exit(1)
    console.log('\nBaseline OK.')
  }
}

main()
