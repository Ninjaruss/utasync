import type { Language, LineAlignmentQuality, LyricsData, SungPhrase, TimedLine } from '../core/types'
import { alignLyrics, lineWeight, sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import {
  isInterjectionLyricLine,
  normalizeForMatch,
  qualityRank,
  scoreLineAlignment,
  type LineAnchorSource,
} from '../ai-pipeline/contentAligner'
import { derivePhrases, type PhraseNormalizeReport } from './phraseNormalize'
import { anchorLineByPartialMatch } from '../ai-pipeline/partialMatchAnchor'
import { realignRepeatedStanzaOccurrences, realignRepeatedRepetitionOnlyLines, repairRepetitionPairAt } from './repeatedStanzaAlignment'
import { findMergedLineGroups, mergedGroupNeedsRealign } from '../ai-pipeline/alignTimestampMode'
import { isRepetitionOnlyLine } from './lineAligner'

const REPETITION_REF_MIN_SPAN_S = 1.4

/** Bump when auto-align timing logic changes — triggers one-time re-refine from the
 * persisted Whisper transcript on song open (no re-transcription). */
export const ALIGNMENT_PIPELINE_VERSION = 17

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

/** Max lines to walk outward when searching for a 'good'-quality anchor. */
const MAX_ANCHOR_SEARCH_LINES = 15

/** Local transcript window when scoring a line's alignment quality. */
const LINE_VALIDATE_WINDOW_LEAD_S = 6
const LINE_VALIDATE_WINDOW_TAIL_S = 8
/** Wider search when the first pass flags a line for retry. */
const LINE_RETRY_EXPAND_LEAD_S = 14
const LINE_RETRY_EXPAND_TAIL_S = 16
/** Minimum visible highlight when a row has room before the next start. */
const MIN_HIGHLIGHT_S = 1.2
/** Max orphan gap (seconds) to claim for a mis-transcribed line tail. */
const ORPHAN_GAP_FILL_MAX_S = 4
/** Silence gap (seconds) after the last transcript word that triggers tail-clipping. */
const SILENCE_CLIP_THRESHOLD_S = 2.5
/** Maximum tail to keep after the last word in a clipped line. */
const MAX_TAIL_AFTER_WORD_S = 1.5

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
    const wn = normalizeForMatch(w.word)
    if (!wn) continue
    let shared = 0
    for (const ch of runNorm.slice(0, 12)) if (wn.includes(ch)) shared++
    const runOpener = /^(凍|痛|転|走)/.test(wn) || shared >= 3
    if (w.startTime < entwined.startTime + 0.8 && !runOpener) continue
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

function enforceLineMonotonicity(out: TimedLine[]): void {
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
}

function realignMergedLineGroups(
  lines: TimedLine[],
  rawWords: TranscriptWord[],
  sourceLanguage: Language,
): TimedLine[] {
  const groups = findMergedLineGroups(lines, rawWords)
  if (!groups.length) return lines

  const clean = sanitizeTranscript(rawWords)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))

  for (const group of groups) {
    if (!mergedGroupNeedsRealign(out, group)) continue
    const lo = group[0]
    const hi = group[group.length - 1]
    const prevEnd = lo > 0 ? out[lo - 1].endTime : 0
    const nextStart = hi + 1 < out.length ? out[hi + 1].startTime : lastTime
    const windowStart = Math.max(prevEnd, out[lo].startTime - 4)
    const windowEnd = Math.min(lastTime, Math.max(out[hi].endTime + 2, nextStart))
    const windowWords = clean.filter(
      (w) => w.endTime > windowStart && w.startTime < windowEnd,
    )
    if (windowWords.length === 0) continue

    const slice = out.slice(lo, hi + 1)
    const texts = slice.map((l) => l.original || l.translation)
    const { lines: aligned, anchorSources } = alignLyrics(
      texts,
      windowWords,
      slice,
      sourceLanguage,
    )
    const merged = slice.map((orig, k) => ({
      ...orig,
      startTime: aligned[k].startTime,
      endTime: aligned[k].endTime,
    }))
    const refined = validateAndRetryLineTimings(
      merged,
      windowWords,
      sourceLanguage,
      anchorSources,
    )
    for (let k = 0; k < group.length; k++) {
      out[lo + k].startTime = refined.lines[k].startTime
      out[lo + k].endTime = refined.lines[k].endTime
    }
  }

  return out
}

function extendUndershotLinesWithPartialMatch(
  lines: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))

  for (let i = 0; i < out.length; i++) {
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : lastTime
    const span = out[i].endTime - out[i].startTime
    const gap = nextStart - out[i].endTime
    if (gap <= 0.15 || gap > ORPHAN_GAP_FILL_MAX_S) continue
    if (span >= MIN_HIGHLIGHT_S && gap < 1.2) continue

    const lineText = out[i].original || out[i].translation
    const score = scoreLineAlignment(lineText, clean.filter(
      (w) => w.endTime > out[i].startTime - 4 && w.startTime < nextStart + 4,
    ), sourceLanguage)
    if (score.coverage >= 0.82 && span >= MIN_HIGHLIGHT_S) continue

    const partial = retryPartialMatchForLine(
      lineText,
      out[i],
      clean,
      i > 0 ? out[i - 1].endTime : 0,
      nextStart,
      lastTime,
    )
    if (!partial) continue
    const extendedEnd = Math.min(nextStart, Math.max(out[i].endTime, partial.endTime))
    if (extendedEnd <= out[i].startTime + 0.2) continue
    if (extendedEnd - out[i].startTime <= span + 0.25) continue
    out[i].endTime = extendedEnd
  }

  return out
}

/**
 * Clip line endTimes that extend into long silences after the last transcript
 * word within the line's span.  Fixes cases like a 17-second span where
 * Whisper produced no chunks for an 8-second instrumental break that follows
 * the singing (e.g. line 13 凍てつく地面… in AKFG).
 *
 * Only fires when the gap between the last word's end and the line's endTime
 * exceeds SILENCE_CLIP_THRESHOLD_S (2.5 s).  Safe to run after extend passes.
 */
function clipSilencePaddedLineTails(
  lines: TimedLine[],
  transcriptWords: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(transcriptWords)
  const out = lines.map((l) => ({ ...l }))

  for (let i = 0; i < out.length; i++) {
    const line = out[i]
    // Words that start within this line's span (exclude words that only bleed
    // in from the previous chunk).
    const wordsIn = clean.filter(
      (w) => w.startTime >= line.startTime && w.startTime < line.endTime,
    )
    if (wordsIn.length === 0) continue

    const lastWordEnd = wordsIn.at(-1)!.endTime
    const silence = line.endTime - lastWordEnd
    if (silence <= SILENCE_CLIP_THRESHOLD_S) continue

    const nextStart = i + 1 < out.length ? out[i + 1].startTime : Infinity
    const clipped = Math.min(lastWordEnd + MAX_TAIL_AFTER_WORD_S, nextStart - 0.05)
    if (clipped - line.startTime < MIN_HIGHLIGHT_S) continue
    out[i].endTime = clipped
  }

  return out
}

/**
 * Recover timing for interjection-type lines (嗚呼, repeated vowels, etc.)
 * when a previous line's tail-extension has absorbed the transcript chunk that
 * belongs to the interjection.
 *
 * Two cases are handled:
 *  A) Gap case: the interjection starts after prevLine.endTime and there is a
 *     short (< 3 s) chunk between them.  The previous line absorbed that chunk.
 *  B) Absorbed-no-gap case: prevLine.endTime == interjection.startTime (zero
 *     gap), but the interjection starts exactly at a chunk's END rather than
 *     its start — i.e. the chunk is just before interjStart.  Re-assign.
 */
function recoverInterjectionTiming(
  lines: TimedLine[],
  transcriptWords: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(transcriptWords)
  const out = lines.map((l) => ({ ...l }))

  for (let i = 1; i < out.length; i++) {
    if (!isInterjectionLyricLine(out[i].original || out[i].translation)) continue

    const prevEnd = out[i - 1].endTime
    const interjStart = out[i].startTime
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : Infinity

    // Case A: gap between prev line and interjection — look for absorbed chunk.
    if (interjStart > prevEnd + 0.1) {
      const chunk = clean.find(
        (w) =>
          w.startTime > prevEnd - 0.5
          && w.startTime < interjStart
          && w.endTime > prevEnd
          && w.endTime - w.startTime < 3.0,
      )
      if (chunk) {
        if (out[i - 1].endTime > chunk.startTime + 0.05) {
          out[i - 1].endTime = chunk.startTime - 0.05
        }
        out[i].startTime = chunk.startTime
        out[i].endTime = Math.min(chunk.endTime, nextStart - 0.05)
      }
      continue
    }

    // Case B: interjection is butted right against prev line end (zero gap),
    // but its startTime coincides with a chunk's endTime — the chunk was
    // absorbed.  Check for a short chunk ending at or very near interjStart.
    const absorbed = clean.find(
      (w) =>
        Math.abs(w.endTime - interjStart) < 0.15
        && w.endTime - w.startTime < 3.0
        && w.startTime >= out[i - 1].startTime,
    )
    if (!absorbed) continue
    // Verify the chunk starts after the previous line's own LCS region would
    // naturally end (i.e. it isn't the chunk that defines prevLine's timing).
    if (absorbed.startTime <= out[i - 1].startTime + 0.1) continue

    // Trim prev line to the chunk's start; give interjection the chunk.
    out[i - 1].endTime = absorbed.startTime - 0.05
    out[i].startTime = absorbed.startTime
    out[i].endTime = Math.min(absorbed.endTime, nextStart - 0.05)
  }

  return out
}

/** Extend vocal tails and fix rolling-chorus boundaries on validated sheet rows. */
function extendValidatedLineTails(lines: TimedLine[], words: TranscriptWord[]): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))

  for (let i = 0; i < out.length; i++) {
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : lastTime
    const runFollows =
      i + 1 < out.length
      && ENTWINED_ROLLING_RE.test(out[i].original)
      && RUN_LINE_RE.test(out[i + 1].original)
    const windowWords = clean.filter(
      (w) => w.endTime > out[i].startTime - 0.5 && w.startTime < nextStart + (runFollows ? 4 : 2),
    )
    const maxEnd = runFollows
      ? Math.min(lastTime, out[i + 1].startTime + 2.5, out[i].endTime + 5)
      : Math.min(lastTime, nextStart - 0.05, out[i].endTime + 3.5)
    if (maxEnd <= out[i].startTime + 0.08) continue
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

  enforceLineMonotonicity(out)
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

function resyncEntwinedRollingPair(
  lines: TimedLine[],
  targetIndex: number,
  words: TranscriptWord[],
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  const tuned = extendValidatedLineTails(out, words)
  if (ENTWINED_ROLLING_RE.test(out[targetIndex].original)) {
    const tStart = tuned[targetIndex].startTime
    const tEnd = tuned[targetIndex].endTime
    if (tEnd - tStart > 0.1) {
      out[targetIndex].startTime = tStart
      out[targetIndex].endTime = tEnd
    }
    if (targetIndex + 1 < out.length && RUN_LINE_RE.test(out[targetIndex + 1].original)) {
      const rStart = tuned[targetIndex + 1].startTime
      const rEnd = tuned[targetIndex + 1].endTime
      if (rEnd - rStart > 0.1) {
        out[targetIndex + 1].startTime = rStart
        out[targetIndex + 1].endTime = rEnd
      }
    }
  } else if (
    targetIndex > 0
    && ENTWINED_ROLLING_RE.test(out[targetIndex - 1].original)
    && RUN_LINE_RE.test(out[targetIndex].original)
  ) {
    const eStart = tuned[targetIndex - 1].startTime
    const eEnd = tuned[targetIndex - 1].endTime
    if (eEnd - eStart > 0.1) {
      out[targetIndex - 1].startTime = eStart
      out[targetIndex - 1].endTime = eEnd
    }
    const rStart = tuned[targetIndex].startTime
    const rEnd = tuned[targetIndex].endTime
    if (rEnd - rStart > 0.1) {
      out[targetIndex].startTime = rStart
      out[targetIndex].endTime = rEnd
    }
  }
  return out
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
    // Require the first char of the next phrase to be present so common kana
    // (e.g. なく appearing in both 見えなくなった and なくした) can't trigger a
    // false-positive onset detection mid-phrase.
    if (head[0] && wn.includes(head[0])) {
      let shared = 1
      for (const ch of head.slice(1, 4)) if (wn.includes(ch)) shared++
      if (shared >= 2) return accStart
    }
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
  const order = [...phrases].sort(
    (a, b) => a.startTime - b.startTime || a.sourceLineIndices[0] - b.sourceLineIndices[0],
  )
  return phrases.map((p) => {
    const minSpan = minPhraseVocalSpan(p.original)
    const span = p.endTime - p.startTime
    if (span >= minSpan) return p
    const ordIdx = order.indexOf(p)
    const nextStart = order[ordIdx + 1]?.startTime ?? p.endTime + minSpan + 4
    const norm = normalizeForMatch(p.original)
    const open = norm.slice(0, Math.min(8, norm.length))
    const close = norm.slice(-Math.min(8, norm.length))
    let start = p.startTime
    let end = p.endTime
    const window = words.filter(
      (w) => w.endTime > p.startTime - 6 && w.startTime < Math.min(p.endTime + 6, nextStart + 0.5),
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
    end = Math.min(end, nextStart - 0.05)
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

function retryPartialMatchForLine(
  lineText: string,
  line: TimedLine,
  clean: readonly TranscriptWord[],
  prevEnd: number,
  nextStart: number,
  lastTime: number,
): { startTime: number; endTime: number } | null {
  const searchFrom = Math.max(prevEnd, line.startTime - LINE_RETRY_EXPAND_LEAD_S)
  // Keep the search inside this row's window. Letting it run past the next row's
  // onset lets a repeated line (e.g. a ローリング chorus) latch onto a LATER
  // occurrence, jumping the row forward where monotonicity then collapses it to
  // the floor and breaks chorus ordering.
  const searchTo = Math.min(
    lastTime,
    line.endTime + LINE_RETRY_EXPAND_TAIL_S,
    nextStart > line.startTime ? nextStart + 0.5 : lastTime,
  )
  const partial = anchorLineByPartialMatch(lineText, clean, searchFrom, searchTo)
  if (!partial) return null
  const startTime = Math.max(partial.startTime, prevEnd)
  // Never let the retry push this row's start at/after the next row.
  if (nextStart > prevEnd && startTime >= nextStart) return null
  const endTime = Math.max(partial.endTime, startTime + 0.35)
  if (endTime > nextStart + 0.5 && nextStart > startTime) return null
  return { startTime, endTime }
}

function expandSquashedLineHighlights(lines: TimedLine[]): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const span = out[i].endTime - out[i].startTime
    if (span >= MIN_HIGHLIGHT_S) continue
    const nextStart = out[i + 1]?.startTime ?? out[i].endTime + MIN_HIGHLIGHT_S
    const room = nextStart - out[i].startTime
    if (room < MIN_HIGHLIGHT_S) continue
    out[i].endTime = Math.min(out[i].startTime + Math.max(span, MIN_HIGHLIGHT_S), nextStart)
  }
  return out
}

function recomputeLineQuality(
  lines: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): Pick<LineValidationResult, 'anchorSources' | 'lineAlignmentQuality'> {
  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const anchorSources: LineAnchorSource[] = []
  const lineAlignmentQuality: LineAlignmentQuality[] = []
  for (let i = 0; i < lines.length; i++) {
    const prevEnd = i > 0 ? lines[i - 1].endTime : 0
    const nextStart = i + 1 < lines.length ? lines[i + 1].startTime : lastTime
    const windowWords = transcriptWindowForLine(
      clean,
      lines[i],
      prevEnd,
      nextStart,
      lastTime,
      LINE_VALIDATE_WINDOW_LEAD_S,
      LINE_VALIDATE_WINDOW_TAIL_S,
    )
    const score = scoreLineAlignment(lines[i].original || lines[i].translation, windowWords, sourceLanguage)
    anchorSources[i] =
      score.quality === 'needs_review' && anchorSourcesIn?.[i] === 'lcs' ? 'lcs' : score.anchorSource
    lineAlignmentQuality[i] = score.quality
  }
  return { anchorSources, lineAlignmentQuality }
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
      if (score.quality !== 'good') {
        const partial = retryPartialMatchForLine(
          lineText,
          out[i],
          clean,
          prevEnd,
          nextStart,
          lastTime,
        )
        if (partial) {
          out[i].startTime = partial.startTime
          out[i].endTime = partial.endTime
          score = scoreLineAlignment(lineText, windowWords, sourceLanguage)
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
  let tunedLines = realignMergedLineGroups(validated.lines, words, sourceLanguage)
  tunedLines = realignRepeatedStanzaOccurrences(
    tunedLines,
    words,
    lineTexts,
    sourceLanguage,
  )
  tunedLines = realignRepeatedRepetitionOnlyLines(tunedLines, words, lineTexts, sourceLanguage)
  tunedLines = extendValidatedLineTails(tunedLines, words)
  tunedLines = extendUndershotLinesWithPartialMatch(tunedLines, words, sourceLanguage)
  tunedLines = clipSilencePaddedLineTails(tunedLines, words)
  tunedLines = recoverInterjectionTiming(tunedLines, words)
  tunedLines = expandSquashedLineHighlights(tunedLines)
  const quality = recomputeLineQuality(
    tunedLines,
    words,
    sourceLanguage,
    pass1.anchorSources,
  )
  const syncedPhrases = syncPhrasesFromValidatedLines(phrases, tunedLines)

  return {
    lines: tunedLines,
    phrases: syncedPhrases,
    report,
    mode: pass1.mode,
    confidence: pass1.confidence,
    anchorSources: quality.anchorSources,
    lineAlignmentQuality: quality.lineAlignmentQuality,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}

/**
 * Re-align the weak section that contains `targetIndex` using anchor-based
 * boundary detection. Walks outward (up to MAX_ANCHOR_SEARCH_LINES each
 * direction) to find `good`-quality anchor lines. The section between the
 * anchors is re-aligned from scratch using `alignLyrics` on the transcript
 * words that fall within the anchor time bounds, then refined with
 * `validateAndRetryLineTimings`.
 *
 * Anchor lines are never modified. Non-timing fields (translation, tokens,
 * furigana, etc.) are preserved on section lines.
 */
export function realignSection(
  lines: TimedLine[],
  targetIndex: number,
  transcriptWords: TranscriptWord[],
  qualityIn: LineAlignmentQuality[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
  options?: {
    /**
     * When true, skip bulk-alignment heuristics (repetition-pair repair,
     * ENTWINED_ROLLING resync) and go straight to the general alignLyrics path.
     * Use this for focused per-line resync where the transcript words are
     * already constrained to the correct audio section.
     */
    focused?: boolean
  },
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
} {
  // Already well-matched — realigning would not improve anything and risks
  // corrupting the timing of neighboring approximate/needs_review lines.
  if (qualityIn[targetIndex] === 'good') {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  const clean = sanitizeTranscript(transcriptWords)
  const lastTime = clean.at(-1)?.endTime ?? 0

  // Walk left to find the nearest 'good' anchor, capped at MAX_ANCHOR_SEARCH_LINES.
  let leftAnchorIdx = -1 // -1 = use t=0 as boundary
  for (let i = targetIndex - 1; i >= 0 && targetIndex - i <= MAX_ANCHOR_SEARCH_LINES; i--) {
    if (qualityIn[i] === 'good') { leftAnchorIdx = i; break }
  }

  // Walk right to find the nearest 'good' anchor, capped at MAX_ANCHOR_SEARCH_LINES.
  let rightAnchorIdx = lines.length // lines.length = use lastTime as boundary
  for (let i = targetIndex + 1; i < lines.length && i - targetIndex <= MAX_ANCHOR_SEARCH_LINES; i++) {
    if (qualityIn[i] === 'good') { rightAnchorIdx = i; break }
  }

  const lineTexts = lines.map((l) => l.original || l.translation)
  const targetText = lineTexts[targetIndex] ?? lines[targetIndex].original
  const initialSectionLo = leftAnchorIdx + 1
  const initialSectionHi = rightAnchorIdx - 1
  const initialPairIdx = isRepetitionOnlyLine(targetText)
    ? targetIndex
    : targetIndex + 1 < lines.length && isRepetitionOnlyLine(lineTexts[targetIndex + 1] ?? '')
      ? targetIndex + 1
      : -1
  const initialPairSection =
    initialPairIdx > 0
    && initialSectionLo <= initialSectionHi
    && (initialSectionLo === initialPairIdx && initialSectionHi === initialPairIdx
      || (initialSectionHi - initialSectionLo === 1
        && initialSectionHi === initialPairIdx
        && initialPairIdx - 1 === initialSectionLo))

  if (initialPairSection && !options?.focused) {
    const outLines = lines.map((l) => ({ ...l }))
    const repaired = repairRepetitionPairAt(
      outLines,
      initialPairIdx,
      clean,
      lineTexts,
      sourceLanguage,
      { preservePrevStart: leftAnchorIdx === initialPairIdx - 1 },
    )
    if (repaired) {
      const outQuality: LineAlignmentQuality[] = [...qualityIn]
      const outAnchors: LineAnchorSource[] = anchorSourcesIn
        ? [...anchorSourcesIn]
        : lines.map(() => 'interpolated' as LineAnchorSource)
      for (const li of [initialPairIdx - 1, initialPairIdx]) {
        const prevEnd = li > 0 ? outLines[li - 1].endTime : 0
        const nextStart = li + 1 < outLines.length ? outLines[li + 1].startTime : lastTime
        const windowWords = transcriptWindowForLine(
          clean,
          outLines[li],
          prevEnd,
          nextStart,
          lastTime,
          LINE_VALIDATE_WINDOW_LEAD_S,
          LINE_VALIDATE_WINDOW_TAIL_S,
        )
        const score = scoreLineAlignment(lineTexts[li], windowWords, sourceLanguage)
        outQuality[li] = score.quality
        outAnchors[li] = score.anchorSource
      }
      return { lines: outLines, lineAlignmentQuality: outQuality, anchorSources: outAnchors }
    }
    const rollingSpan = lines[initialPairIdx].endTime - lines[initialPairIdx].startTime
    if (rollingSpan >= REPETITION_REF_MIN_SPAN_S) {
      return {
        lines,
        lineAlignmentQuality: qualityIn,
        anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
      }
    }
  }

  // Helper accessors that read the current anchor indices.
  const anchorFrom = () => (leftAnchorIdx >= 0 ? lines[leftAnchorIdx].endTime : 0)
  const anchorTo = () => (rightAnchorIdx < lines.length ? lines[rightAnchorIdx].startTime : lastTime)
  const anchorLineCount = () => rightAnchorIdx - leftAnchorIdx - 1

  // If the initial anchors are too close together (< 1 s/line) the initial
  // alignment likely crammed several lines into one transcript word and the
  // anchor timing is itself wrong. Walk one step further out in each direction
  // to find anchors with a realistic time spread.
  if (anchorTo() - anchorFrom() < anchorLineCount() * 1.0) {
    let newLeft = -1
    for (let i = (leftAnchorIdx < 0 ? -1 : leftAnchorIdx) - 1; i >= 0; i--) {
      if (qualityIn[i] === 'good') { newLeft = i; break }
    }
    let newRight = lines.length
    for (let i = (rightAnchorIdx >= lines.length ? lines.length : rightAnchorIdx) + 1; i < lines.length; i++) {
      if (qualityIn[i] === 'good') { newRight = i; break }
    }
    leftAnchorIdx = newLeft
    rightAnchorIdx = newRight
    // Final fallback: still too tight → use full song range.
    if (anchorTo() - anchorFrom() < anchorLineCount() * 1.0) {
      leftAnchorIdx = -1
      rightAnchorIdx = lines.length
    }
  }

  const sectionLo = leftAnchorIdx + 1
  let sectionHi = rightAnchorIdx - 1
  if (sectionLo > sectionHi) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  if (sectionLo <= sectionHi && !options?.focused) {
    if (
      ENTWINED_ROLLING_RE.test(targetText)
      || (targetIndex > 0 && ENTWINED_ROLLING_RE.test(lineTexts[targetIndex - 1] ?? ''))
    ) {
      const outLines = resyncEntwinedRollingPair(lines, targetIndex, clean)
      const outQuality: LineAlignmentQuality[] = [...qualityIn]
      const outAnchors: LineAnchorSource[] = anchorSourcesIn
        ? [...anchorSourcesIn]
        : lines.map(() => 'interpolated' as LineAnchorSource)
      const tuneLo = ENTWINED_ROLLING_RE.test(targetText) ? targetIndex : targetIndex - 1
      const tuneHi = RUN_LINE_RE.test(lineTexts[tuneLo + 1] ?? '') ? tuneLo + 1 : tuneLo
      for (let li = tuneLo; li <= tuneHi; li++) {
        const prevEnd = li > 0 ? outLines[li - 1].endTime : 0
        const nextStart = li + 1 < outLines.length ? outLines[li + 1].startTime : lastTime
        const windowWords = transcriptWindowForLine(
          clean,
          outLines[li],
          prevEnd,
          nextStart,
          lastTime,
          LINE_VALIDATE_WINDOW_LEAD_S,
          LINE_VALIDATE_WINDOW_TAIL_S,
        )
        const score = scoreLineAlignment(lineTexts[li], windowWords, sourceLanguage)
        outQuality[li] = score.quality
        outAnchors[li] = score.anchorSource
      }
      return { lines: outLines, lineAlignmentQuality: outQuality, anchorSources: outAnchors }
    }
  }

  const strictFrom = anchorFrom()
  const strictTo = anchorTo()
  const strictWords = clean.filter(
    (w) => w.endTime > strictFrom && w.startTime < strictTo,
  )
  if (strictWords.length === 0) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  // When a single row sits between two good anchors inside one Whisper segment,
  // align it together with the neighbor anchor row for split/orphan-fill context
  // but do not overwrite anchor timings (AKFG 角を曲がって｜此処から…).
  let contextLo = sectionLo
  let contextHi = sectionHi
  if (sectionLo === sectionHi) {
    if (rightAnchorIdx === sectionHi + 1 && rightAnchorIdx < lines.length) {
      contextHi = rightAnchorIdx
    }
    if (leftAnchorIdx === sectionLo - 1 && leftAnchorIdx >= 0) {
      contextLo = leftAnchorIdx
    }
  }

  // Time range is between anchor endpoints.
  let timeFrom = anchorFrom()
  let timeTo = anchorTo()
  if (contextHi > sectionHi && rightAnchorIdx < lines.length && contextHi === rightAnchorIdx) {
    timeTo = Math.min(lastTime, Math.max(timeTo, lines[rightAnchorIdx].endTime))
  }
  if (contextLo < sectionLo && leftAnchorIdx >= 0 && contextLo === leftAnchorIdx) {
    timeFrom = Math.max(0, Math.min(timeFrom, lines[leftAnchorIdx].startTime))
  }

  // Words that overlap the anchor time range, clipped so a straddling word
  // doesn't drag line timestamps outside the section bounds.
  const sectionWords = clean
    .filter((w) => w.endTime > timeFrom && w.startTime < timeTo)
    .map((w) => ({
      ...w,
      startTime: Math.max(w.startTime, timeFrom),
      endTime: Math.min(w.endTime, timeTo),
    }))
    .filter((w) => w.startTime < w.endTime)

  // No words in range → can't improve; return unchanged.
  if (sectionWords.length === 0) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  // Fresh alignment pass on the section (+ neighbor context rows when needed).
  const contextSlice = lines.slice(contextLo, contextHi + 1)
  const contextTexts = contextSlice.map((l) => l.original || l.translation)
  const { lines: aligned, anchorSources: pass1Anchors } = alignLyrics(
    contextTexts,
    sectionWords as TranscriptWord[],
    contextSlice,
    sourceLanguage,
  )

  // Merge timing into originals (preserve translation, tokens, furigana, etc.)
  const mergedContext: TimedLine[] = contextSlice.map((orig, k) => ({
    ...orig,
    startTime: aligned[k].startTime,
    endTime: aligned[k].endTime,
  }))

  // Refine and score.
  const refined = validateAndRetryLineTimings(
    mergedContext,
    sectionWords as TranscriptWord[],
    sourceLanguage,
    pass1Anchors,
  )

  // Merge back into full-length output arrays (skip context-only anchor rows).
  const outLines = [...lines]
  const outQuality: LineAlignmentQuality[] = [...qualityIn]
  const outAnchors: LineAnchorSource[] = anchorSourcesIn
    ? [...anchorSourcesIn]
    : lines.map(() => 'interpolated' as LineAnchorSource)

  for (let k = 0; k < refined.lines.length; k++) {
    const li = contextLo + k
    if (li < sectionLo || li > sectionHi) continue
    outLines[li] = {
      ...lines[li],
      startTime: refined.lines[k].startTime,
      endTime: refined.lines[k].endTime,
    }
    outQuality[li] = refined.lineAlignmentQuality[k]
    outAnchors[li] = refined.anchorSources[k]
  }

  return { lines: outLines, lineAlignmentQuality: outQuality, anchorSources: outAnchors }
}

/**
 * Re-align all `needs_review` and `approximate` lines by grouping them into
 * contiguous sections and calling `realignSection` once per section.
 * Sections are accumulated sequentially so each re-anchored section's updated
 * timing becomes anchor context for the next.
 */
export function realignAllWeakSections(
  lines: TimedLine[],
  transcriptWords: TranscriptWord[],
  qualityIn: LineAlignmentQuality[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
} {
  const weakIndices = lines
    .map((_, i) => i)
    .filter((i) => qualityIn[i] === 'needs_review' || qualityIn[i] === 'approximate')

  if (weakIndices.length === 0) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  // Group weak indices into contiguous runs.
  const sections: number[][] = []
  let current = [weakIndices[0]]
  for (let i = 1; i < weakIndices.length; i++) {
    if (weakIndices[i] === weakIndices[i - 1] + 1) {
      current.push(weakIndices[i])
    } else {
      sections.push(current)
      current = [weakIndices[i]]
    }
  }
  sections.push(current)

  // Re-align each section using the middle line's index as the target.
  let acc: { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] | undefined } =
    { lines, lineAlignmentQuality: qualityIn, anchorSources: anchorSourcesIn }

  for (const section of sections) {
    const targetIndex = section[Math.floor(section.length / 2)]
    acc = realignSection(
      acc.lines,
      targetIndex,
      transcriptWords,
      acc.lineAlignmentQuality,
      sourceLanguage,
      acc.anchorSources,
    )
  }

  return acc as { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] }
}
