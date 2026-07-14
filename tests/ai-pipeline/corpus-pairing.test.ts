import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji, { type Tokenizer } from 'kuromoji'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { alignLinesTokens } from '../../src/ai-pipeline/wordAligner'
import { buildAlignJob, smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import { fixAdjacentTranslationOrder } from '../../src/ai-pipeline/translationOrder'
import { setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'
import { applyReadingCorrections } from '../../src/language/japanese/readingCorrections'
import { isAlignableToken, isParticleToken } from '../../src/core/language'
import { splitTranslationWords } from '../../src/language/wordColors'
import { createCachedEmbedTexts } from '../../scripts/lib/cachedEmbedder.mjs'
import type { TimedLine } from '../../src/core/types'

/**
 * CI guard for word-pairing accuracy: runs the real pairing pipeline over every
 * corpus song that has a translation, using the committed embedding cache
 * (tests/ai-pipeline/fixtures/embeddings-cache.json) so it is deterministic and
 * needs no model download — a cache miss throws instead of silently embedding.
 * Mirrors auditPairing() in scripts/audit-corpus.mjs (same duplication pattern
 * as corpus-scorecard.test.ts for alignment metrics).
 *
 * pair_unpaired / pair_magnet are structural; pair_wrong counts hand-labeled
 * known-bad pairs (fixtures/pairing-truth.json) the pairer still produces.
 * After a legitimate metric change, re-snapshot with:
 *   npx tsx scripts/audit-corpus.mjs --pairing --write-baseline
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')
const ROOT = join(here, '../..')

interface CorpusSong {
  name: string
  lang: 'ja' | 'en'
  lyrics: string
  transcript: string
  en?: string
}

interface WrongPairTruth {
  line: string
  surface: string
  target: string
}

function loadTranscriptWords(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime!, endTime: w.endTime! }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as { songs: CorpusSong[] }
const baseline = JSON.parse(readFileSync(join(FIXTURES, 'corpus-baseline.json'), 'utf8')) as Record<
  string,
  Record<string, number | string>
>
const pairingTruth = JSON.parse(readFileSync(join(FIXTURES, 'pairing-truth.json'), 'utf8')) as Record<
  string,
  WrongPairTruth[]
>

const pairedSongs = manifest.songs.filter((s) => s.en)

// Documented measurement artifacts (same protocol as corpus-scorecard.test.ts):
// cells allowed to exceed the baseline because the increment is a verified
// side effect of a fix, not a new bad pair. Each entry needs a findings-doc
// reference; remove it when the baseline is next ratcheted.
const ALLOWED_MEASUREMENT_ARTIFACTS: Record<string, Record<string, number>> = {
  // Round-5 finding P10 (CLASS-P1): fixing the spurious adjacent-translation
  // swap restores the CORRECT translation ("I screamed without being able to
  // let it out") on the second occurrence of 出せない状態で叫んだよ (fixture
  // row 43), so the pre-existing known-bad truth pair 状態→without — counted
  // once per occurrence because truth entries match by line text — now fires
  // on both occurrences instead of one. The pair itself is unchanged
  // noise-floor behavior (P11 class); the count was 7 only while the defect
  // displayed the WRONG translation (no "without" among its words) on row 43.
  'guitar-loneliness-word': { pair_wrong: 8 },
}

describe('audit corpus — word pairing non-regression (cached embeddings)', () => {
  let tokenizer: Tokenizer
  let embedTexts: (texts: string[]) => Promise<number[][]>

  beforeAll(async () => {
    // Strict cache mode: no fallback — a miss means fixtures changed without
    // regenerating the cache, and must fail loudly rather than drift.
    embedTexts = createCachedEmbedTexts({ cachePath: join(FIXTURES, 'embeddings-cache.json') }).embedTexts
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
    tokenizer = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: join(ROOT, 'public/dict') }).build((err, t) => (err ? reject(err) : resolve(t!)))
    })
  }, 60_000)

  function tokenizeJa(text: string) {
    let index = 0
    const tokens = tokenizer.tokenize(text).map((t) => {
      const startIndex = index
      index += t.surface_form.length
      return {
        surface: t.surface_form,
        reading: t.reading,
        pos: t.pos,
        posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
        startIndex,
        endIndex: index,
      }
    })
    return applyReadingCorrections(tokens)
  }

  it('baseline has pair_* rows for every translated corpus song', () => {
    const missing = pairedSongs
      .filter((s) => typeof baseline[s.name]?.pair_unpaired !== 'number')
      .map((s) => s.name)
    expect(missing, 're-snapshot with: npx tsx scripts/audit-corpus.mjs --pairing --write-baseline').toEqual([])
  })

  for (const song of pairedSongs) {
    it(`${song.name} pairing does not regress vs baseline`, async () => {
      const lineTexts = readFileSync(join(FIXTURES, song.lyrics), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const words = loadTranscriptWords(join(FIXTURES, song.transcript))
      const sheetRows: TimedLine[] = lineTexts.map((original) => ({
        original,
        translation: '',
        startTime: 0,
        endTime: 0,
      }))
      const refined = refineAlignmentWithPhrases(sheetRows, words, song.lang)

      const enBlock = readFileSync(join(FIXTURES, song.en!), 'utf8').trim()
      const withEn = (await smartAttachSecondLanguage(refined.lines, enBlock, embedTexts)).lines
      const tokenized = withEn.map((line) => ({ ...line, tokens: tokenizeJa(line.original) }))
      const ordered = fixAdjacentTranslationOrder(tokenized)

      const jobs = ordered
        .filter((line) => line.translation?.trim())
        .map((line) => {
          const tokens = line.tokens ?? tokenizeJa(line.original)
          return { line, job: buildAlignJob({ ...line, tokens }) }
        })
      const aligned = await alignLinesTokens(jobs.map((j) => j.job), embedTexts, { maxTextsPerBatch: 64 })

      let unpaired = 0
      let magnet = 0
      let wrong = 0
      const truthEntries = pairingTruth[song.name] ?? []
      jobs.forEach(({ line }, li) => {
        const result = aligned[li]
        const translationWords = splitTranslationWords(line.translation ?? '')
        for (const truth of truthEntries) {
          if (truth.line !== line.original) continue
          const produced = result.some(
            (t) =>
              t.surface.trim() &&
              truth.surface.includes(t.surface) &&
              t.alignmentIndices?.some(
                (i) => (translationWords[i] ?? '').toLowerCase() === truth.target.toLowerCase(),
              ),
          )
          if (produced) wrong++
        }
        const targetSources = new Map<number, number[]>()
        let pos = 0
        for (const t of result) {
          if (isParticleToken(t) || !t.surface.trim()) {
            pos++
            continue
          }
          const idx = t.alignmentIndices
          if (!idx || idx.length === 0) {
            if (isAlignableToken(t)) unpaired++
            pos++
            continue
          }
          if (isAlignableToken(t)) {
            for (const i of idx) {
              if (!targetSources.has(i)) targetSources.set(i, [])
              targetSources.get(i)!.push(pos)
            }
          }
          pos++
        }
        for (const positions of targetSources.values()) {
          if (positions.length < 3) continue
          const contiguous = positions.every((p, k) => k === 0 || p === positions[k - 1] + 1)
          if (!contiguous) magnet++
        }
      })

      const base = baseline[song.name]
      expect(unpaired, `pair_unpaired regressed`).toBeLessThanOrEqual(base.pair_unpaired as number)
      expect(magnet, `pair_magnet regressed`).toBeLessThanOrEqual(base.pair_magnet as number)
      const wrongCap = Math.max(
        base.pair_wrong as number,
        ALLOWED_MEASUREMENT_ARTIFACTS[song.name]?.pair_wrong ?? 0,
      )
      expect(wrong, `pair_wrong regressed (known-bad pairs reappeared)`).toBeLessThanOrEqual(wrongCap)
    }, 120_000)
  }
})
