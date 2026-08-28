import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import { identity, truthStrings } from '../../scripts/lib/translationPerturbations.mjs'
import { PERTURBATIONS } from '../../scripts/lib/linePairingCorpus.mjs'
import { scoreLinePairing, mapRowsToOriginals } from '../../scripts/lib/linePairingScore.mjs'
import { createCachedEmbedTexts } from '../../scripts/lib/cachedEmbedder.mjs'
import type { TimedLine } from '../../src/core/types'

/**
 * CI guard for line-pairing accuracy on perturbed (non-1:1) translations.
 * Uses the committed embedding cache so it is deterministic and needs no model
 * download — a cache miss throws rather than silently embedding.
 * Re-snapshot ONLY with a findings note:
 *   npx tsx scripts/audit-line-pairing.mjs --write-baseline
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '../ai-pipeline/fixtures')

interface Row {
  song: string
  perturbation: string
  line_correct: number
  line_wrong: number
  line_missing: number
  lines_unplaced: number
  lines_lost: number
}

const readLines = (p: string) =>
  readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

describe('line-pairing ratchet', () => {
  const baseline: Row[] = JSON.parse(
    readFileSync(join(FIXTURES, 'line-pairing-baseline.json'), 'utf8'),
  )
  const corpus = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  const songs = corpus.songs.filter((s: { en?: string }) => s.en)
  const measured = new Map<string, Row>()

  beforeAll(async () => {
    const { embedTexts } = createCachedEmbedTexts({
      cachePath: join(FIXTURES, 'embeddings-cache.json'),
    })
    for (const song of songs) {
      const originals = readLines(join(FIXTURES, song.lyrics))
      const translations = readLines(join(FIXTURES, song.en))
      for (const p of PERTURBATIONS) {
        const state = p.apply(identity(translations), originals)
        const primary: TimedLine[] = originals.map((original, i) => ({
          startTime: i * 2, endTime: i * 2 + 2, original, translation: '',
        }))
        const result = await smartAttachSecondLanguage(
          primary, state.lines.join('\n'), embedTexts,
        )
        const { assigned, flagged } = mapRowsToOriginals(originals, result.lines)
        const m = scoreLinePairing(truthStrings(state), assigned, state.lines, flagged, result.extras ?? [])
        measured.set(`${song.name}::${p.name}`, { song: song.name, perturbation: p.name, ...m })
      }
    }
  }, 120_000)

  it('measures every baseline row', () => {
    expect(baseline.length).toBeGreaterThan(0)
    for (const b of baseline) {
      expect(measured.has(`${b.song}::${b.perturbation}`), `${b.song}/${b.perturbation}`).toBe(true)
    }
  })

  it('never regresses against the committed baseline', () => {
    for (const b of baseline) {
      const m = measured.get(`${b.song}::${b.perturbation}`)!
      const where = `${b.song}/${b.perturbation}`
      expect(m.line_wrong, `${where} line_wrong`).toBeLessThanOrEqual(b.line_wrong)
      expect(m.line_missing, `${where} line_missing`).toBeLessThanOrEqual(b.line_missing)
      expect(m.lines_unplaced, `${where} lines_unplaced`).toBeLessThanOrEqual(b.lines_unplaced)
      expect(m.lines_lost, `${where} lines_lost`).toBeLessThanOrEqual(b.lines_lost)
      expect(m.line_correct, `${where} line_correct`).toBeGreaterThanOrEqual(b.line_correct)
    }
  })
})
