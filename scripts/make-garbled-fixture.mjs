/**
 * Deterministic generator for the garbled/desert-transcript corpus fixture
 * (round-6 Task E). CI's audit corpus is otherwise all-healthy transcriptions,
 * so the user-screenshot pileup (approx slivers on a hallucinated blip, zero-
 * duration rows, dishonest labels) never tripped the scorecard. This freezes
 * the diagnosis repro as a committed fixture that the round-6 B/C honesty fixes
 * are guarded against.
 *
 * Recipe (docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md, H1/H2):
 * from the healthy committed akfg word transcript,
 *   1. drop every chunk whose timestamp MIDPOINT falls in [188, 258]s — the
 *      evidence desert over sheet rows 16-21 (+ the 赤い lead-in);
 *   2. insert one hallucinated function-word-ish chunk `ような` at [228, 229]s,
 *      a false activity region inside the desert that attracts the run;
 *   3. sort chunks by start time (input is already sorted; keeps the inserted
 *      chunk in place and the file diff-legible).
 * The honesty guard tests/ai-pipeline/garbledFixture.guard.test.ts runs the full
 * pipeline over the emitted fixture and asserts the round-6 B/C invariants hold;
 * its recipe-pin re-derives the desert window so a stale fixture cannot pass.
 *
 * Deterministic: no Date, no random. Re-running reproduces the committed JSON.
 *
 * Run:  npx tsx scripts/make-garbled-fixture.mjs
 *   (add --check to verify the committed fixture is up to date without writing)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'tests/ai-pipeline/fixtures/akfg')
const SRC = join(dir, 'transcript.word.json')
const OUT = join(dir, 'transcript.word.garbled.json')

const DESERT = [188, 258] // midpoint window to drop (sheet rows 16-21 + 赤い)
const HALLUCINATION = { text: 'ような', timestamp: [228, 229] }

function garble(raw) {
  const chunks = (raw.chunks ?? []).filter((c) => {
    const [s, e] = c.timestamp ?? []
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false
    const mid = (s + e) / 2
    return !(mid >= DESERT[0] && mid <= DESERT[1])
  })
  chunks.push({ text: HALLUCINATION.text, timestamp: [...HALLUCINATION.timestamp] })
  chunks.sort((a, b) => (a.timestamp?.[0] ?? 0) - (b.timestamp?.[0] ?? 0))
  // Reconstruct the top-level text so the file stays internally consistent and
  // format-identical to transcript.word.json (text + chunks). No loader reads
  // it — only `chunks` drives alignment — but keeping it truthful avoids a
  // stale concatenation lying about the surviving words.
  const text = chunks.map((c) => c.text ?? '').join('')
  return { text, chunks }
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const out = garble(raw)
const serialized = JSON.stringify(out, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8')
  if (current !== serialized) {
    console.error(`✗ ${OUT} is stale — re-run: npx tsx scripts/make-garbled-fixture.mjs`)
    process.exit(1)
  }
  console.log('✓ garbled fixture is up to date.')
} else {
  writeFileSync(OUT, serialized)
  console.log(`Wrote ${out.chunks.length} chunks to ${OUT} (dropped desert ${DESERT[0]}-${DESERT[1]}s, added 1 hallucination).`)
}
