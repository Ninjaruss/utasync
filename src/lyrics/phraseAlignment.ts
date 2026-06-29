import type { Language, LineAlignmentQuality, LyricsData, SungPhrase, TimedLine } from '../core/types'
import { alignLyrics, lineWeight, sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import {
  normalizeForMatch,
  qualityRank,
  scoreLineAlignment,
  type LineAnchorSource,
} from '../ai-pipeline/contentAligner'
import { derivePhrases, type PhraseNormalizeReport } from './phraseNormalize'

/** Bump when auto-align timing logic changes — triggers one-time re-refine from the
 * persisted Whisper transcript on song open (no re-transcription). */
export const ALIGNMENT_PIPELINE_VERSION = 9

const ENTWINED_ROLLING_RE = /心絡まって.*ローリング/
const RUN_LINE_RE = /凍てつく(?:世界|地面).*走り出した/

/** Search slack (seconds) around pass-1 hints when re-anchoring each phrase. */
const PHRASE_WINDOW_LEAD_S = 5
/** When pass-2 LCS is weak, keep pass-1 onset instead of estimatedLineStart bleed. */
const PHRASE_REALIGN_MIN_CONF = 0.55
/** Max seconds after pass-1 end to search when the next phrase is far away. */
const PHRASE_WINDOW_TAIL_S = 12
/** Next phrase within this gap shares a vocal run — allow a little bleed past its hint. */
const PHRASE_ADJACENT_GAP_S = 3
/** Pass-1 onset within this many seconds of the forward cursor — look back for its segment. */
const PHRASE_ONSET_CURSOR_S = 0.5
/** When pass-1 start is only slightly after the cursor, prior segments may hold the vocal. */
const PHRASE_LOOKBACK_AFTER_CURSOR_S = 10
/** Non-interjection rows shorter than this after pass-2 are treated as a regression. */
const PHRASE_MIN_VOCAL_S = 1.5

/** Local transcript window when scoring a line's alignment quality. */
const LINE_VALIDATE_WINDOW_LEAD_S = 6
const LINE_VALIDATE_WINDOW_TAIL_S = 8
/** Wider search when the first pass flags a line for retry. */
const LINE_RETRY_EXPAND_LEAD_S = 14
const LINE_RETRY_EXPAND_TAIL_S = 16

/** Pass-1 placed this phrase at the forward cursor — include overlapping segments. */
function phraseOnsetAtCursor(phraseStart: number, searchFrom: number): boolean {
  return (
    Math.abs(phraseStart - searchFrom) <= PHRASE_ONSET_CURSOR_S ||
    phraseStart <= searchFrom + 0.15
  )
}

/** Vocal may still live in a segment that began before the forward cursor. */
function phraseNeedsLookback(phraseStart: number, searchFrom: number): boolean {
  const gap = phraseStart - searchFrom
  return searchFrom > 0 && gap >= 1.2 && gap < PHRASE_LOOKBACK_AFTER_CURSOR_S
}

/** Pass-2 clearly broke pass-1 timing — keep the draft span. */
function pass2Regressed(
  draft: SungPhrase,
  startTime: number,
  endTime: number,
): boolean {
  const draftSpan = Math.max(0.08, draft.endTime - draft.startTime)
  const span = Math.max(0, endTime - startTime)
  if (span < Math.min(PHRASE_MIN_VOCAL_S, draftSpan * 0.35)) return true
  if (
    draft.anchorSource === 'lcs' &&
    startTime > draft.startTime + 3 &&
    span < draftSpan * 0.5
  ) {
    return true
  }
  if (draft.anchorSource === 'lcs' && endTime < draft.endTime - 1) return true
  return false
}

/** When Whisper splits a lyric tail across the next segment, extend through it. */
function extendThroughMatchingTail(
  phraseText: string,
  startTime: number,
  endTime: number,
  windowWords: readonly TranscriptWord[],
  maxEnd: number,
): number {
  const tails = ['走り出した', '走り出し']
  const hit = tails.find((t) => phraseText.includes(t))
  if (!hit) return endTime
  let extended = endTime
  for (const w of windowWords) {
    if (
      w.word.includes(hit) &&
      w.startTime >= startTime - 0.5 &&
      w.endTime <= maxEnd + 0.5
    ) {
      extended = Math.max(extended, w.endTime)
    }
  }
  return extended
}

/** Extend a line's end through transcript words that match its closing glyphs. */
function extendLineEndToTranscriptTail(
  line: TimedLine,
  windowWords: readonly TranscriptWord[],
  maxEnd: number,
): number {
  const lineNorm = normalizeForMatch(line.original)
  if (lineNorm.length < 2) return line.endTime
  // Only extend through a later word that actually carries this line's CLOSING
  // glyphs — i.e. Whisper split the line's tail across the next segment. A looser
  // "shares any 2 chars" gate previously matched coarse segment-mode chunks that
  // merely share common kana, stretching a line across the trailing instrumental
  // up to the next line's onset (the 君の孤独…暴き出す朝だ → +33s over-extension).
  const tail = lineNorm.slice(-3)
  if (tail.length < 2) return line.endTime
  let extended = line.endTime
  for (const w of windowWords) {
    if (w.startTime < line.startTime - 0.3) continue
    if (w.startTime > maxEnd) break
    if (w.endTime <= line.endTime - 0.15) continue
    const wn = normalizeForMatch(w.word)
    if (wn && wn.includes(tail)) {
      extended = Math.max(extended, Math.min(w.endTime, maxEnd))
    }
  }
  return extended
}

/** Split 心絡まって/ローリング from the following 凍てつく…走り出した run line. */
function rebalanceEntwinedRunPair(
  entwined: TimedLine,
  run: TimedLine,
  clean: readonly TranscriptWord[],
  lastTime: number,
): { entwinedEnd: number; runStart: number; runEnd: number } {
  let runStart = run.startTime
  let runEnd = run.endTime
  const tailWords = clean.filter(
    (w) => w.startTime >= entwined.startTime - 0.5 && w.startTime <= lastTime + 0.5,
  )
  runEnd = extendThroughMatchingTail(run.original, runStart, runEnd, tailWords, lastTime)

  const runNorm = normalizeForMatch(run.original)
  for (const w of tailWords) {
    if (w.startTime < entwined.startTime + 0.8) continue
    const wn = normalizeForMatch(w.word)
    if (!wn) continue
    let shared = 0
    for (const ch of runNorm.slice(0, 12)) if (wn.includes(ch)) shared++
    if (shared >= 3 || /^(凍|痛|転|走)/.test(wn)) {
      runStart = Math.min(runStart, w.startTime)
    }
    if (wn.includes('走り') || wn.includes('出し')) {
      runEnd = Math.max(runEnd, w.endTime)
    }
  }

  runStart = Math.max(runStart, entwined.startTime + 0.3)
  const entwinedEnd = Math.min(entwined.endTime, runStart)
  runEnd = Math.max(runEnd, runStart + 1.2)
  return { entwinedEnd, runStart, runEnd }
}

/** Extend vocal tails and fix rolling-chorus boundaries on validated sheet rows. */
function extendValidatedLineTails(lines: TimedLine[], words: TranscriptWord[]): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))

  for (let i = 0; i < out.length; i++) {
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : lastTime
    const windowWords = clean.filter(
      (w) => w.endTime > out[i].startTime - 0.5 && w.startTime < nextStart + 4,
    )
    const maxEnd = Math.min(lastTime, nextStart > out[i].endTime ? nextStart + 0.15 : nextStart + 3.5)
    out[i].endTime = extendLineEndToTranscriptTail(out[i], windowWords, maxEnd)
    out[i].endTime = extendThroughMatchingTail(
      out[i].original,
      out[i].startTime,
      out[i].endTime,
      windowWords,
      maxEnd,
    )
  }

  for (let i = 0; i < out.length - 1; i++) {
    if (!ENTWINED_ROLLING_RE.test(out[i].original)) continue
    if (!RUN_LINE_RE.test(out[i + 1].original)) continue
    const { entwinedEnd, runStart, runEnd } = rebalanceEntwinedRunPair(
      out[i],
      out[i + 1],
      clean,
      lastTime,
    )
    out[i].endTime = Math.max(out[i].startTime + 0.08, entwinedEnd)
    out[i + 1].startTime = runStart
    out[i + 1].endTime = runEnd
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i].startTime < out[i - 1].startTime) out[i].startTime = out[i - 1].startTime
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endTime > out[i + 1].startTime) out[i].endTime = out[i + 1].startTime
    const ownEnd = Math.max(out[i].endTime, out[i].startTime)
    out[i].endTime = Math.min(ownEnd, out[i + 1].startTime)
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].endTime <= out[i].startTime) {
      out[i].endTime = out[i].startTime + 0.3
    }
  }
  return out
}

function trimEmbeddedNextVocal(
  phrases: SungPhrase[],
  words: readonly TranscriptWord[],
): SungPhrase[] {
  const order = [...phrases].sort(
    (a, b) => a.startTime - b.startTime || a.sourceLineIndices[0] - b.sourceLineIndices[0],
  )
  for (let i = 0; i < order.length - 1; i++) {
    const cur = order[i]
    const next = order[i + 1]
    if (cur.sourceLineIndices.length > 1) continue
    if (cur.endTime - cur.startTime < 5.5) continue
    const onset = findNextVocalOnset(cur, next, words)
    if (
      onset !== null &&
      onset > cur.startTime + 1.2 &&
      onset < cur.endTime - 0.35
    ) {
      cur.endTime = onset
    }
  }
  return phrases
}

/** Post-pass: tighten boundaries, extend short vocals, remove cross-line bleed. */
function finalizePhraseTimings(
  phrases: SungPhrase[],
  words: TranscriptWord[],
): SungPhrase[] {
  const clean = sanitizeTranscript(words)
  let out = phrases.map((p) => ({ ...p }))
  out = trimEmbeddedNextVocal(out, clean)
  out = capEndsAtNextVocalOnset(out, clean)
  out = extendUndershotPhrases(out, clean)
  out = enforceMonotonicPhrases(out)
  return out
}

function findNextVocalOnset(
  current: SungPhrase,
  next: SungPhrase,
  words: readonly TranscriptWord[],
): number | null {
  const probe = normalizeForMatch(next.original).replace(/\s/g, '')
  if (probe.length < 2) return null
  const head = probe.slice(0, Math.min(6, probe.length))
  const searchFrom = current.startTime + 0.5
  let acc = ''
  let accStart = searchFrom
  for (const w of words) {
    if (w.startTime < searchFrom) continue
    if (w.startTime > next.endTime + 2) break
    if (acc && w.startTime - accStart > 0.55) {
      acc = normalizeForMatch(w.word)
      accStart = w.startTime
    } else {
      if (!acc) accStart = w.startTime
      acc += normalizeForMatch(w.word)
    }
    const wn = acc
    if (!wn) continue
    if (wn.startsWith(head.slice(0, 2)) || head.startsWith(wn.slice(0, 2))) {
      return accStart
    }
    let shared = 0
    for (const ch of head.slice(0, 4)) if (wn.includes(ch)) shared++
    if (shared >= 2) return accStart
  }
  return null
}

function capEndsAtNextVocalOnset(
  phrases: SungPhrase[],
  words: readonly TranscriptWord[],
): SungPhrase[] {
  const order = [...phrases].sort(
    (a, b) => a.startTime - b.startTime || a.sourceLineIndices[0] - b.sourceLineIndices[0],
  )
  for (let i = 0; i < order.length - 1; i++) {
    const cur = order[i]
    const next = order[i + 1]
    if (cur.endTime <= next.startTime + 0.2) continue
    const bleed = cur.endTime - next.startTime
    // Small adjacency overlap — leave to enforceMonotonicPhrases.
    if (bleed < 1.5) continue
    const onset = findNextVocalOnset(cur, next, words)
    if (onset !== null && onset > cur.startTime + 0.8 && onset < cur.endTime - 0.2) {
      cur.endTime = Math.min(cur.endTime, onset)
    } else {
      cur.endTime = Math.min(cur.endTime, next.startTime)
    }
    cur.endTime = Math.max(cur.endTime, cur.startTime + 0.08)
  }
  return phrases
}

function minPhraseVocalSpan(original: string): number {
  if (/^(嗚呼|うーん|あー)/.test(original.trim())) return 0.5
  if (/ローリング/.test(original)) return 2.2
  return 2.0
}

function extendUndershotPhrases(
  phrases: SungPhrase[],
  words: readonly TranscriptWord[],
): SungPhrase[] {
  return phrases.map((p) => {
    const minSpan = minPhraseVocalSpan(p.original)
    const span = p.endTime - p.startTime
    if (span >= minSpan) return p
    const norm = normalizeForMatch(p.original)
    const open = norm.slice(0, Math.min(8, norm.length))
    const close = norm.slice(-Math.min(8, norm.length))
    let start = p.startTime
    let end = p.endTime
    const window = words.filter(
      (w) => w.endTime > p.startTime - 6 && w.startTime < p.endTime + 6,
    )
    if (open.length >= 2) {
      let acc = ''
      for (const w of [...window].sort((a, b) => a.startTime - b.startTime)) {
        acc += normalizeForMatch(w.word)
        let hit = 0
        for (const ch of open.slice(0, 4)) if (acc.includes(ch)) hit++
        if (hit >= 2) {
          start = Math.min(start, w.startTime)
          break
        }
      }
    }
    for (const w of window) {
      const wn = normalizeForMatch(w.word)
      if (close.length >= 2) {
        let hit = 0
        for (const ch of close.slice(-4)) if (wn.includes(ch)) hit++
        if (hit >= 2) end = Math.max(end, w.endTime)
      }
    }
    end = Math.max(end, start + Math.max(minSpan, span))
    if (end - start > span + 0.15 || start < p.startTime - 0.1) {
      return { ...p, startTime: start, endTime: end }
    }
    return p
  })
}

function enforceMonotonicPhrases(phrases: SungPhrase[]): SungPhrase[] {
  const order = [...phrases].sort(
    (a, b) => a.startTime - b.startTime || a.sourceLineIndices[0] - b.sourceLineIndices[0],
  )
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1]
    const cur = order[i]
    if (cur.startTime < prev.endTime - 0.05) {
      cur.startTime = prev.endTime
    }
    if (prev.endTime > cur.startTime + 0.05) {
      prev.endTime = cur.startTime
    }
    if (cur.endTime <= cur.startTime) {
      cur.endTime = cur.startTime + minPhraseVocalSpan(cur.original)
    }
    prev.endTime = Math.max(prev.endTime, prev.startTime + 0.08)
  }
  return phrases
}

/** Pasted sheet rows to align — never the sung-layout display rows. */
export function sheetRowsForAlignment(lyrics: LyricsData): TimedLine[] {
  if (lyrics.sheetLinesSnapshot?.length) return lyrics.sheetLinesSnapshot
  return lyrics.lines
}

/** Re-run phrase-aware timing when the pipeline version is stale. */
export function shouldRefineStoredAlignment(lyrics: LyricsData): boolean {
  if (!lyrics.lines.length) return false
  if (lyrics.alignmentMode !== 'auto') return false
  if (!lyrics.transcriptWords?.length) return false
  return (lyrics.alignmentPipelineVersion ?? 0) < ALIGNMENT_PIPELINE_VERSION
}

export function transcriptWordsToAlignInput(
  words: LyricsData['transcriptWords'],
): TranscriptWord[] {
  return (words ?? []).map((w) => ({
    word: w.word,
    startTime: w.startTime,
    endTime: w.endTime,
  }))
}

/** Merge a refine pass into persisted lyrics (timings, phrases, pipeline version). */
export function applyRefinedAlignment(lyrics: LyricsData, refined: RefinedAlignment): LyricsData {
  return {
    ...lyrics,
    lines: refined.lines,
    phrases: refined.phrases,
    phraseLayout: refined.phraseLayout,
    sheetLinesSnapshot:
      refined.phraseLayout === 'sung' ? refined.sheetLinesSnapshot : undefined,
    anchorSources: refined.anchorSources,
    lineAlignmentQuality: refined.lineAlignmentQuality,
    alignmentConfidence: refined.confidence,
    alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION,
  }
}

/**
 * Pass 2: re-anchor each phrase inside a local transcript window.
 * Phrases are processed in chronological order with a forward-only transcript
 * cursor so repeated lyrics (e.g. two "ローリング ローリング" rows) cannot latch
 * onto an earlier vocal occurrence.
 */
export function alignPhrasesToTranscript(
  phrases: SungPhrase[],
  words: TranscriptWord[],
  sourceLanguage: Language,
): SungPhrase[] {
  if (phrases.length === 0) return []
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const order = phrases
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.startTime - b.p.startTime || a.i - b.i)

  let searchFrom = 0
  const byIndex = new Map<number, SungPhrase>()

  for (let o = 0; o < order.length; o++) {
    const { p, i } = order[o]
    const nextHint = order[o + 1]?.p.startTime ?? lastTime
    const naturalStart = Math.max(0, p.startTime - PHRASE_WINDOW_LEAD_S)
    const forwardStart = searchFrom > 0 ? searchFrom - 0.2 : 0
    const onsetAtCursor = phraseOnsetAtCursor(p.startTime, searchFrom)
    const lookback = phraseNeedsLookback(p.startTime, searchFrom)
    const useOverlapWindow = onsetAtCursor || lookback
    // When pass-1 anchored this row at the forward cursor, the transcript segment
    // can start slightly before searchFrom (segment mode). Later rows in the same
    // breath must still use forwardStart so an earlier segment cannot bleed in.
    const windowStart = onsetAtCursor
      ? naturalStart
      : lookback
        ? Math.max(naturalStart, searchFrom - PHRASE_WINDOW_LEAD_S)
        : Math.max(naturalStart, forwardStart)
    const nextIsLastPhrase = order[o + 1] === undefined
    const gapToNext = nextHint - p.startTime
    const farNextPhrase = !nextIsLastPhrase && gapToNext > 45
    const adjacentNext = nextHint - p.endTime < PHRASE_ADJACENT_GAP_S
    const windowEnd = Math.min(
      lastTime,
      farNextPhrase
        ? p.endTime + PHRASE_WINDOW_TAIL_S
        : adjacentNext
          ? nextHint + 4
          : nextHint > p.startTime + 1
            ? nextHint - 0.5
            : p.endTime + 8,
      nextIsLastPhrase ? lastTime : p.endTime + PHRASE_WINDOW_TAIL_S,
    )
    const windowWords = clean.filter((w) =>
      useOverlapWindow
        ? w.endTime > windowStart && w.startTime < windowEnd
        : w.startTime >= windowStart - 0.05 && w.startTime < windowEnd,
    )
    if (windowWords.length === 0) {
      byIndex.set(i, p)
      searchFrom = Math.max(searchFrom, p.endTime)
      continue
    }

    const { lines, anchorSources, confidence } = alignLyrics(
      [p.original],
      windowWords,
      undefined,
      sourceLanguage,
    )
    const aligned = lines[0]
    let startTime = aligned.startTime
    let endTime = aligned.endTime
    const alignedSpan = Math.max(0, endTime - startTime)
    const draftSpan = Math.max(0.08, p.endTime - p.startTime)
    const draftAnchored = p.anchorSource === 'lcs'
    const startRegressed = draftAnchored && startTime > p.startTime + 1.5
    const spanCollapsed =
      draftAnchored && alignedSpan < Math.min(1.2, draftSpan * 0.4)
    const weakMatch = confidence < PHRASE_REALIGN_MIN_CONF

    if (weakMatch && (startRegressed || spanCollapsed)) {
      // Pass-2 window missed the vocal (e.g. segment starts at 147 but cursor is 147.6).
      startTime = p.startTime
      endTime = p.endTime
    } else if (weakMatch) {
      const vocalFoundFar =
        !draftAnchored && aligned.startTime > p.startTime + 10
      if (vocalFoundFar) {
        startTime = Math.max(searchFrom, aligned.startTime)
        endTime = aligned.endTime
      } else {
        startTime = Math.max(
          useOverlapWindow ? Math.max(0, searchFrom - 0.5) : searchFrom,
          p.startTime,
        )
        endTime = Math.max(
          p.endTime,
          Math.min(aligned.endTime, p.endTime + 8, windowEnd),
        )
      }
    } else {
      const floorStart = onsetAtCursor
        ? Math.max(0, searchFrom - 0.5)
        : searchFrom
      startTime = Math.max(startTime, floorStart)
    }
    const nextPhrase = order[o + 1]?.p
    if (nextPhrase && endTime > nextPhrase.startTime + 0.15) {
      endTime = nextPhrase.startTime
    }
    const tailMaxEnd = Math.min(
      windowEnd,
      nextPhrase?.startTime ?? windowEnd,
    )
    endTime = extendThroughMatchingTail(
      p.original,
      startTime,
      endTime,
      windowWords,
      tailMaxEnd,
    )
    if (pass2Regressed(p, startTime, endTime)) {
      startTime = p.startTime
      endTime = p.endTime
    }
    endTime = Math.max(endTime, startTime + 0.08)
    searchFrom = Math.max(searchFrom, endTime)
    byIndex.set(i, {
      ...p,
      startTime,
      endTime,
      anchorSource: (anchorSources?.[0] ?? p.anchorSource) as SungPhrase['anchorSource'],
    })
  }

  return phrases.map((p, i) => byIndex.get(i) ?? p)
}

function transcriptWindowForLine(
  clean: readonly TranscriptWord[],
  line: TimedLine,
  prevEnd: number,
  nextStart: number,
  lastTime: number,
  leadS: number,
  tailS: number,
): TranscriptWord[] {
  const windowStart = Math.max(0, prevEnd - 0.5, line.startTime - leadS)
  const windowEnd = Math.min(lastTime, nextStart + 0.5, line.endTime + tailS)
  return clean.filter((w) => w.endTime > windowStart && w.startTime < windowEnd)
}

function retryLineInWindows(
  lineText: string,
  line: TimedLine,
  clean: readonly TranscriptWord[],
  prevEnd: number,
  nextStart: number,
  lastTime: number,
  sourceLanguage: Language,
): { startTime: number; endTime: number; score: ReturnType<typeof scoreLineAlignment> } | null {
  const windows = [
    transcriptWindowForLine(clean, line, prevEnd, nextStart, lastTime, LINE_VALIDATE_WINDOW_LEAD_S, LINE_VALIDATE_WINDOW_TAIL_S),
    transcriptWindowForLine(clean, line, prevEnd, nextStart, lastTime, LINE_RETRY_EXPAND_LEAD_S, LINE_RETRY_EXPAND_TAIL_S),
  ]
  let best: {
    startTime: number
    endTime: number
    score: ReturnType<typeof scoreLineAlignment>
  } | null = null

  for (const windowWords of windows) {
    if (windowWords.length === 0) continue
    const { lines: aligned } = alignLyrics([lineText], windowWords, undefined, sourceLanguage)
    const score = scoreLineAlignment(lineText, windowWords, sourceLanguage)
    const rank = qualityRank(score.quality)
    const bestRank = best ? qualityRank(best.score.quality) : -1
    const improved =
      !best
      || rank > bestRank
      || (rank === bestRank && score.coverage > best.score.coverage + 0.05)
    if (!improved) continue
    best = { startTime: aligned[0].startTime, endTime: aligned[0].endTime, score }
  }

  return best
}

export interface LineValidationResult {
  lines: TimedLine[]
  anchorSources: LineAnchorSource[]
  lineAlignmentQuality: LineAlignmentQuality[]
  retryCount: number
}

/** Score each line against its local transcript window; retry weak rows once. */
export function validateAndRetryLineTimings(
  lines: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): LineValidationResult {
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))
  const anchorSources: LineAnchorSource[] = anchorSourcesIn?.length
    ? [...anchorSourcesIn]
    : lines.map(() => 'interpolated')
  while (anchorSources.length < out.length) anchorSources.push('interpolated')
  const lineAlignmentQuality: LineAlignmentQuality[] = []
  let retryCount = 0

  for (let i = 0; i < out.length; i++) {
    const prevEnd = i > 0 ? out[i - 1].endTime : 0
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : lastTime
    const lineText = out[i].original || out[i].translation
    const windowWords = transcriptWindowForLine(
      clean,
      out[i],
      prevEnd,
      nextStart,
      lastTime,
      LINE_VALIDATE_WINDOW_LEAD_S,
      LINE_VALIDATE_WINDOW_TAIL_S,
    )
    let score = scoreLineAlignment(lineText, windowWords, sourceLanguage)

    if (score.quality !== 'good') {
      const retried = retryLineInWindows(
        lineText,
        out[i],
        clean,
        prevEnd,
        nextStart,
        lastTime,
        sourceLanguage,
      )
      if (retried) {
        const oldRank = qualityRank(score.quality)
        const newRank = qualityRank(retried.score.quality)
        if (newRank > oldRank || (newRank === oldRank && retried.score.coverage > score.coverage + 0.08)) {
          out[i].startTime = retried.startTime
          out[i].endTime = retried.endTime
          score = retried.score
          retryCount++
        }
      }
    }

    anchorSources[i] = score.anchorSource
    lineAlignmentQuality[i] = score.quality
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i].startTime < out[i - 1].startTime) out[i].startTime = out[i - 1].startTime
    const ownEnd = Math.max(out[i].endTime, out[i].startTime)
    const cap = out[i + 1]?.startTime ?? ownEnd
    out[i].endTime = Math.min(ownEnd, cap)
  }

  return { lines: out, anchorSources, lineAlignmentQuality, retryCount }
}

function syncPhrasesFromValidatedLines(
  phrases: SungPhrase[],
  validatedLines: TimedLine[],
): SungPhrase[] {
  return phrases.map((p) => {
    if (p.sourceLineIndices.length === 1) {
      const li = p.sourceLineIndices[0]
      const row = validatedLines[li]
      if (!row) return p
      return { ...p, startTime: row.startTime, endTime: row.endTime }
    }
    const starts = p.sourceLineIndices
      .map((i) => validatedLines[i]?.startTime)
      .filter((t): t is number => Number.isFinite(t))
    const ends = p.sourceLineIndices
      .map((i) => validatedLines[i]?.endTime)
      .filter((t): t is number => Number.isFinite(t))
    if (starts.length === 0) return p
    return { ...p, startTime: Math.min(...starts), endTime: Math.max(...ends) }
  })
}

/** Distribute a merged phrase's vocal span across its source sheet rows by length. */
function projectMergedPhrase(
  lines: TimedLine[],
  phrase: SungPhrase,
  sourceLanguage: Language,
  out: TimedLine[],
): void {
  const src = phrase.sourceLineIndices
  const weights = src.map((i) => {
    const text = lines[i]?.original?.trim() ?? ''
    return text ? Math.max(1, lineWeight(text, sourceLanguage)) : 1
  })
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const span = Math.max(0, phrase.endTime - phrase.startTime)
  let cum = 0
  for (let k = 0; k < src.length; k++) {
    const li = src[k]
    const startFrac = cum / total
    cum += weights[k]
    const endFrac = cum / total
    const start = phrase.startTime + span * startFrac
    const end = phrase.startTime + span * endFrac
    out[li] = { ...out[li], startTime: start, endTime: Math.max(end, start) }
  }
}

/** Map phrase-level timings back onto pasted sheet rows (merges, splits, 1:1). */
export function projectPhraseTimingToLines(
  lines: TimedLine[],
  phrases: SungPhrase[],
  sourceLanguage: Language,
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))

  for (const phrase of phrases) {
    const src = phrase.sourceLineIndices
    if (src.length > 1) {
      projectMergedPhrase(lines, phrase, sourceLanguage, out)
      continue
    }
    if (src.length !== 1) continue
    const li = src[0]
    const siblings = phrases.filter(
      (p) => p.sourceLineIndices.length === 1 && p.sourceLineIndices[0] === li,
    )
    if (siblings.length === 1) {
      out[li] = { ...out[li], startTime: phrase.startTime, endTime: phrase.endTime }
    }
  }

  for (let li = 0; li < out.length; li++) {
    const covering = phrases.filter(
      (p) => p.sourceLineIndices.length === 1 && p.sourceLineIndices[0] === li,
    )
    if (covering.length > 1) {
      out[li] = {
        ...out[li],
        startTime: Math.min(...covering.map((p) => p.startTime)),
        endTime: Math.max(...covering.map((p) => p.endTime)),
      }
    }
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i].startTime < out[i - 1].startTime) out[i].startTime = out[i - 1].startTime
    const ownEnd = Math.max(out[i].endTime, out[i].startTime)
    out[i].endTime = Math.min(ownEnd, out[i + 1]?.startTime ?? ownEnd)
  }

  return out
}

export interface RefinedAlignment {
  lines: TimedLine[]
  phrases: SungPhrase[]
  report: PhraseNormalizeReport
  mode: 'content' | 'proportional'
  confidence: number
  anchorSources?: LineAnchorSource[]
  lineAlignmentQuality?: LineAlignmentQuality[]
  phraseLayout: 'sheet' | 'sung'
  sheetLinesSnapshot?: TimedLine[]
}

/**
 * Two-pass align: sheet rows → derive phrases → windowed phrase re-anchor →
 * project back onto the pasted sheet → validate/retry weak rows. Always keeps
 * the user's pasted row layout; sung phrasing is opt-in via the player UI.
 */
export function refineAlignmentWithPhrases(
  sheetRows: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
  _lyricsBase?: Pick<LyricsData, 'translationLanguage' | 'alignmentMode'>,
): RefinedAlignment {
  const transcriptWords = sanitizeTranscript(words)
  const lineTexts = sheetRows.map((l) => l.original || l.translation)
  const pass1 = alignLyrics(lineTexts, words, sheetRows, sourceLanguage)
  const { phrases: draft, report } = derivePhrases(pass1.lines, transcriptWords, pass1.anchorSources)
  const phrases = finalizePhraseTimings(
    alignPhrasesToTranscript(draft, words, sourceLanguage),
    words,
  )

  const projectedLines = projectPhraseTimingToLines(sheetRows, phrases, sourceLanguage)
  const validated = validateAndRetryLineTimings(
    projectedLines,
    words,
    sourceLanguage,
    pass1.anchorSources,
  )
  const extendedLines = extendValidatedLineTails(validated.lines, words)
  const syncedPhrases = syncPhrasesFromValidatedLines(phrases, extendedLines)

  return {
    lines: extendedLines,
    phrases: syncedPhrases,
    report,
    mode: pass1.mode,
    confidence: pass1.confidence,
    anchorSources: validated.anchorSources,
    lineAlignmentQuality: validated.lineAlignmentQuality,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}
