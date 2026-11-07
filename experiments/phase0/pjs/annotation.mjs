// Pure annotation logic for the PJS medley builder, split out so it can be tested without ffmpeg.
// Writes hashes, never lyric text (ADR-0004, CLAUDE.md rule 6).
import { existsSync, readFileSync } from 'node:fs'
import { hashLyricLine, LYRIC_HASH_VERSION } from '../../../scripts/lib/lyricHash.mjs'
import { lyricLines } from '../../../scripts/lib/syncBenchmark.mjs'

// Seconds. Behaviour-gating; see ledger L40 for what each rests on.
export const UNCERTAINTY = Object.freeze({ 'phoneme-label': 0.02, energy: 0.05 })

// lines: [{ text, onset, method?, source? }]; the sheet is those texts, one per line, as the builder writes it.
// Hashes come from the sheet lines as the scorer reads them (lyricLines), so a line the scorer would
// drop or split fails here instead of shifting every later index.
export function buildAnnotation({ lines, audioSha256, lyricsSha256 }) {
  const sheet = lyricLines(lines.map(l => l.text).join('\n'))
  if (sheet.length !== lines.length) throw new Error(`the lyric sheet reads as ${sheet.length} lines but ${lines.length} were given; refusing to build a misaligned annotation`)
  return {
    schemaVersion: 1, kind: 'corpus-onsets', status: 'adjudicated', reviewer: 'corpus', predictionsShown: false,
    priorPredictionExposure: 'none', lineHashVersion: LYRIC_HASH_VERSION, audioSha256, lyricsSha256,
    convention: 'first sung onset of each concatenated PJS sentence; method per line',
    lines: lines.map((l, i) => {
      const method = l.method ?? 'energy'
      if (!Object.hasOwn(UNCERTAINTY, method)) throw new Error(`line ${i + 1}: unknown onset method ${JSON.stringify(method)}`)
      return { textHash: hashLyricLine(sheet[i]), onset: l.onset, uncertainty: UNCERTAINTY[method], excluded: false, method, source: l.source }
    }),
  }
}

// Never destroy other truth: only create a new file or replace another corpus-onsets one.
export function assertSafeToWrite(existing) {
  if (existing?.kind !== 'corpus-onsets') throw new Error(`existing annotation holds a ${JSON.stringify(existing?.kind)} kind; refusing to overwrite`)
}

export function annotationFileToCheck(path) {
  if (!existsSync(path)) return
  let existing
  try { existing = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(`${path} exists but is not readable JSON; refusing to overwrite`) }
  try { assertSafeToWrite(existing) } catch (e) { throw new Error(`${path}: ${e.message}`) }
}
