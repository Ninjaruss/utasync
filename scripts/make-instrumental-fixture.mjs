/**
 * Deterministic generator for the instrumental-placement corpus fixture
 * (round-7 Task 16). The round-6 garbled fixture (make-garbled-fixture.mjs) is a
 * transcript DESERT with a single hallucinated blip; it exercises the honesty
 * floors/labels but not the specific round-7 failure the user reported: a whole
 * verse packed onto an INSTRUMENTAL section that Whisper sprinkled with a few
 * hallucinated noise moras (a false, low-density activity region). This fixture
 * freezes that exact shape so the round-7 run-coverage gate stays guarded.
 *
 * Recipe (docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md, H1/H2 +
 * "Round 7"): from the healthy committed akfg word transcript,
 *   1. DELETE every chunk whose timestamp MIDPOINT falls in [198, 260]s — the
 *      real vocals of sheet rows 16-20 (岩は転がって … 君の孤独も …, ~203-230s)
 *      AND the ♪ instrumental marker at 240s. Row 15 (…歌うんだ, ends ~197s) and
 *      row 21 (赤い赤い…, starts ~261.6s) keep their evidence and stay anchored,
 *      so rows 16-20 become an unanchored degenerate run between them.
 *   2. INSERT four sparse single-mora katakana noise chunks (ネ/ヌ/ホ, ~0.3s each,
 *      spaced ~3s) in the instrumental gap AFTER the block's true position
 *      (245-254s). They cluster into ONE ~9s activity region (gaps < 4s), but
 *      carry only ~1.3s of transcribed audio and lexically corroborate none of
 *      the run's text — so pre-round-7 the packer treated them as activity and
 *      clustered the whole verse onto ~245-254s ("verse on the instrumental"),
 *      while the round-7 run-coverage gate (char-LCS < 0.15 AND wordTime < 1.5s)
 *      rejects the region and the run spreads across its true window at floor.
 *   3. sort chunks by start time (keeps the file diff-legible).
 * The guard tests/ai-pipeline/instrumentalFixture.guard.test.ts runs the full
 * pipeline over the emitted fixture and asserts the run does NOT cluster onto the
 * noise region and stays honestly labelled; its recipe-pin re-derives the window.
 *
 * Deterministic: no Date, no random. Re-running reproduces the committed JSON.
 *
 * Run:  npx tsx scripts/make-instrumental-fixture.mjs
 *   (add --check to verify the committed fixture is up to date without writing)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'tests/ai-pipeline/fixtures/akfg')
const SRC = join(dir, 'transcript.word.json')
const OUT = join(dir, 'transcript.word.instrumental.json')

// Real vocals of sheet rows 16-20 (~203-230s) + the ♪ marker (~240-244s) fall in
// this midpoint window; deleting them leaves rows 16-20 unanchored between the
// row-15 (~197s) and row-21 (~261.6s) anchors.
const BLOCK = [198, 260]
// Sparse hallucinated instrumental noise inserted AFTER the block's true
// position: one ~9s region (consecutive gaps < 4s) carrying only ~1.3s of audio.
const NOISE = [
  { text: 'ネ', timestamp: [245.0, 245.3] },
  { text: 'ヌ', timestamp: [248.1, 248.45] },
  { text: 'ホ', timestamp: [251.0, 251.3] },
  { text: 'ネ', timestamp: [254.0, 254.35] },
]

function instrumentalize(raw) {
  const chunks = (raw.chunks ?? []).filter((c) => {
    const [s, e] = c.timestamp ?? []
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false
    const mid = (s + e) / 2
    return !(mid >= BLOCK[0] && mid <= BLOCK[1])
  })
  for (const n of NOISE) chunks.push({ text: n.text, timestamp: [...n.timestamp] })
  chunks.sort((a, b) => (a.timestamp?.[0] ?? 0) - (b.timestamp?.[0] ?? 0))
  // Reconstruct the top-level text so the file stays internally consistent and
  // format-identical to transcript.word.json. No loader reads it — only `chunks`
  // drives alignment — but keeping it truthful avoids a stale concatenation.
  const text = chunks.map((c) => c.text ?? '').join('')
  return { text, chunks }
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const out = instrumentalize(raw)
const serialized = JSON.stringify(out, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8')
  if (current !== serialized) {
    console.error(`✗ ${OUT} is stale — re-run: npx tsx scripts/make-instrumental-fixture.mjs`)
    process.exit(1)
  }
  console.log('✓ instrumental fixture is up to date.')
} else {
  writeFileSync(OUT, serialized)
  console.log(`Wrote ${out.chunks.length} chunks to ${OUT} (dropped block ${BLOCK[0]}-${BLOCK[1]}s, added ${NOISE.length} noise moras).`)
}
