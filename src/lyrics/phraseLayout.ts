import type { LyricsData, SungPhrase, TimedLine } from '../core/types'

/** A proposed row-structure change between the pasted sheet and the sung phrases,
 * for the "Match song phrasing" review (Phase 3). */
export interface PhraseChange {
  kind: 'split' | 'merge'
  /** Source `lines` indices involved. */
  sourceLineIndices: number[]
  /** Pasted sheet row text(s). */
  before: string[]
  /** Resulting sung phrase text(s). */
  after: string[]
}

/** Diff the pasted rows against the derived phrases into a human-readable change
 * list — merges (N rows → 1 phrase) and splits (1 row → N phrases). Passthrough
 * rows produce no entry. */
export function summarizePhraseChanges(lines: TimedLine[], phrases: SungPhrase[]): PhraseChange[] {
  const changes: PhraseChange[] = []

  for (const p of phrases) {
    if (p.sourceLineIndices.length > 1) {
      changes.push({
        kind: 'merge',
        sourceLineIndices: [...p.sourceLineIndices],
        before: p.sourceLineIndices.map((i) => lines[i]?.original ?? ''),
        after: [p.original],
      })
    }
  }

  const singleSource = new Map<number, SungPhrase[]>()
  for (const p of phrases) {
    if (p.sourceLineIndices.length === 1) {
      const li = p.sourceLineIndices[0]
      const list = singleSource.get(li)
      if (list) list.push(p)
      else singleSource.set(li, [p])
    }
  }
  for (const [li, ps] of singleSource) {
    if (ps.length > 1) {
      changes.push({
        kind: 'split',
        sourceLineIndices: [li],
        before: [lines[li]?.original ?? ''],
        after: ps.map((p) => p.original),
      })
    }
  }

  return changes.sort((a, b) => a.sourceLineIndices[0] - b.sourceLineIndices[0])
}

/** Whether the derived phrases differ from the pasted rows (worth offering the
 * "Match song phrasing" option at all). */
export function hasPhraseChanges(lines: TimedLine[], phrases: SungPhrase[]): boolean {
  return summarizePhraseChanges(lines, phrases).length > 0
}

/** Project the canonical phrases into display rows — one row per sung phrase. */
export function phrasesToTimedLines(phrases: SungPhrase[]): TimedLine[] {
  return phrases.map((p) => ({
    startTime: p.startTime,
    endTime: p.endTime,
    original: p.original,
    translation: p.translation,
    ...(p.tokens ? { tokens: p.tokens } : {}),
  }))
}

/** Switch the rendered rows to the sung phrases, snapshotting the pasted sheet so
 * it can be restored. Idempotent: re-applying keeps the original snapshot. */
export function applySungLayout(lyrics: LyricsData): LyricsData {
  if (!lyrics.phrases?.length) return lyrics
  return {
    ...lyrics,
    sheetLinesSnapshot:
      lyrics.phraseLayout === 'sung' ? lyrics.sheetLinesSnapshot : lyrics.lines,
    lines: phrasesToTimedLines(lyrics.phrases),
    phraseLayout: 'sung',
  }
}

/** Restore the pasted sheet rows captured by {@link applySungLayout}. */
export function revertToSheetLayout(lyrics: LyricsData): LyricsData {
  if (!lyrics.sheetLinesSnapshot) return lyrics
  return {
    ...lyrics,
    lines: lyrics.sheetLinesSnapshot,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}
