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

/** An unplaced pasted line's `afterLineIndex` points into whichever row space is
 * currently rendered. Regrouping rows into phrases changes that space — a merge
 * makes it shorter — so an anchor kept verbatim pointed at a different row or past
 * the end: the "N lines weren't placed" note, and the repair entry point it
 * carries, either vanished or attached itself to an unrelated lyric. */
type Unplaced = LyricsData['unplacedTranslations']

function remapUnplaced(unplaced: Unplaced, remap: (afterLineIndex: number) => number): Unplaced {
  if (!unplaced?.length) return unplaced
  return unplaced.map((u) => ({ ...u, afterLineIndex: remap(u.afterLineIndex) }))
}

/** Source-row index → the phrase row that now contains it. A row merged away
 * resolves to the nearest earlier row that survived, so its note stays with the
 * text it belongs to; -1 (before the first row) stays -1. */
function sheetToPhraseIndex(phrases: SungPhrase[]) {
  const owner = new Map<number, number>()
  phrases.forEach((p, phraseIndex) => {
    for (const sourceIndex of p.sourceLineIndices) owner.set(sourceIndex, phraseIndex)
  })
  return (sheetIndex: number): number => {
    if (sheetIndex < 0) return -1
    for (let i = sheetIndex; i >= 0; i--) {
      const phraseIndex = owner.get(i)
      if (phraseIndex !== undefined) return phraseIndex
    }
    return -1
  }
}

/** The inverse: a phrase row → the last sheet row it was built from, which is
 * where its note goes back to when the pasted rows return. */
function phraseToSheetIndex(phrases: SungPhrase[]) {
  return (phraseIndex: number): number => {
    if (phraseIndex < 0) return -1
    let last = -1
    for (let i = 0; i <= phraseIndex && i < phrases.length; i++) {
      for (const sourceIndex of phrases[i].sourceLineIndices) last = Math.max(last, sourceIndex)
    }
    return last
  }
}

/** Switch the rendered rows to the sung phrases, snapshotting the pasted sheet so
 * it can be restored. Idempotent: re-applying keeps the original snapshot. */
export function applySungLayout(lyrics: LyricsData): LyricsData {
  if (!lyrics.phrases?.length) return lyrics
  // Already sung: `lines` ARE the phrases, so the anchors are already in phrase
  // space and remapping them again would walk them off the end.
  const switching = lyrics.phraseLayout !== 'sung'
  return {
    ...lyrics,
    sheetLinesSnapshot:
      lyrics.phraseLayout === 'sung' ? lyrics.sheetLinesSnapshot : lyrics.lines,
    lines: phrasesToTimedLines(lyrics.phrases),
    phraseLayout: 'sung',
    ...(switching
      ? { unplacedTranslations: remapUnplaced(lyrics.unplacedTranslations, sheetToPhraseIndex(lyrics.phrases)) }
      : {}),
  }
}

/** Restore the pasted sheet rows captured by {@link applySungLayout}, carrying the
 * unplaced-line anchors back into sheet-row space. */
export function revertToSheetLayout(lyrics: LyricsData): LyricsData {
  if (!lyrics.sheetLinesSnapshot) return lyrics
  const switching = lyrics.phraseLayout === 'sung'
  return {
    ...lyrics,
    lines: lyrics.sheetLinesSnapshot,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
    ...(switching && lyrics.phrases?.length
      ? { unplacedTranslations: remapUnplaced(lyrics.unplacedTranslations, phraseToSheetIndex(lyrics.phrases)) }
      : {}),
  }
}
