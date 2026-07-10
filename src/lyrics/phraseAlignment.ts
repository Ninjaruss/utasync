import type { Language, LineAlignmentQuality, LyricsData, SungPhrase, TimedLine } from '../core/types'
import { alignLyrics, lineWeight, sanitizeTranscript, subdivideTranscriptWord, type TranscriptWord } from '../ai-pipeline/aligner'
import {
  computeLineMatchedSpans,
  isInterjectionLyricLine,
  normalizeForMatch,
  qualityRank,
  scoreLineAlignment,
  type LineAnchorSource,
} from '../ai-pipeline/contentAligner'
import { derivePhrases, type PhraseNormalizeReport } from './phraseNormalize'
import { anchorLineByPartialMatch } from '../ai-pipeline/partialMatchAnchor'
import { realignRepeatedStanzaOccurrences, realignRepeatedRepetitionOnlyLines } from './repeatedStanzaAlignment'
import { findMergedLineGroups, mergedGroupNeedsRealign } from '../ai-pipeline/alignTimestampMode'
import { isRepetitionOnlyLine } from './lineAligner'
import { redistributeDegenerateRuns } from './redistributeDegenerateRuns'
import { findPhoneticAnchorEn } from '../ai-pipeline/phoneticEn'
import { minLineDuration } from './lineDegeneracy'

const REPETITION_REF_MIN_SPAN_S = 1.4

/** Bump when auto-align timing logic changes — triggers one-time re-refine from the
 * persisted Whisper transcript on song open (no re-transcription). */
export const ALIGNMENT_PIPELINE_VERSION = 18

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
export const LINE_VALIDATE_WINDOW_LEAD_S = 6
export const LINE_VALIDATE_WINDOW_TAIL_S = 8
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

/** The transcript chunk a line begins inside, IFF the line owns it outright — no
 * other line's start falls within the chunk.  Segment-mode Whisper emits one
 * [start,end] per chunk; a line that solely occupies a chunk should span exactly
 * that chunk.  Returns null for merged chunks (two lines share one segment — left
 * to realignMergedLineGroups) or when no chunk encloses the start. */
function findExclusiveChunk(
  line: TimedLine,
  clean: readonly TranscriptWord[],
  allLines: readonly TimedLine[],
): TranscriptWord | null {
  const enclosing = clean.find(
    (w) => w.startTime - 0.6 <= line.startTime && w.endTime - 0.08 > line.startTime,
  )
  if (!enclosing) return null
  const owners = allLines.filter(
    (l) =>
      l.startTime >= enclosing.startTime - 0.6 && l.startTime < enclosing.endTime - 0.08,
  )
  return owners.length === 1 ? enclosing : null
}

/** Fraction of a line's distinct glyphs that appear in a transcript chunk's text.
 * A cheap phonetic-affinity proxy used to tell which line a chunk belongs to. */
function chunkLineAffinity(chunkText: string, lineText: string): number {
  const lineGlyphs = new Set(normalizeForMatch(lineText))
  if (lineGlyphs.size === 0) return 0
  const chunkGlyphs = new Set(normalizeForMatch(chunkText))
  let hit = 0
  for (const ch of lineGlyphs) if (chunkGlyphs.has(ch)) hit++
  return hit / lineGlyphs.size
}

/** Snap solely-owned lines to their enclosing chunk's start.  When a proportional
 * / LCS estimate places a start a beat late, the previous line over-extends to
 * fill the gap (光輝いた bleeding into 君の孤独).  Snapping the start back — and
 * letting monotonicity clamp the predecessor's tail — fixes both directions at
 * once.  The rolling 心絡まって / 凍てつく pair keeps its dedicated handling.
 *
 * A timing-only ownership test is not enough: a chunk carrying the previous
 * line's tail (…わからないんだ) can still contain the next line's start (ローリング),
 * and snapping there would steal the tail.  So only snap when the chunk's text
 * matches THIS line at least as well as the previous line. */
function snapLinesToOwnedChunks(
  lines: TimedLine[],
  words: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    if (ENTWINED_ROLLING_RE.test(out[i].original) || RUN_LINE_RE.test(out[i].original)) continue
    const chunk = findExclusiveChunk(out[i], clean, out)
    if (!chunk) continue
    const delta = out[i].startTime - chunk.startTime
    // Only a small correction (< 1.5 s late); larger gaps mean a lead-in that
    // legitimately delays the vocal, or a mis-anchor better left alone.
    if (delta <= 0.15 || delta >= 1.5) continue
    // The chunk must phonetically belong to this line alone. If the previous
    // line's tail also lands in it (…わからないんだ | ロリー merged into one chunk),
    // the chunk START belongs to that tail, so snapping this line to the chunk
    // start would steal it — leave the alignLyrics boundary in place.
    const ownAffinity = chunkLineAffinity(chunk.word, out[i].original)
    const prevAffinity = i > 0 ? chunkLineAffinity(chunk.word, out[i - 1].original) : 0
    if (ownAffinity < 0.34 || prevAffinity >= 0.25) continue
    const prevStart = i > 0 ? out[i - 1].startTime : -Infinity
    const snapped = Math.max(chunk.startTime, prevStart + 0.2)
    if (snapped < out[i].startTime) out[i].startTime = snapped
  }
  enforceLineMonotonicity(out)
  return out
}

/** Word-mode run-start finder: locate where the run line's opening glyphs are
 * actually sung.  The opener regex (/^(凍|痛|転|走)/) and the shared>=3 heuristic
 * both fail on single-glyph word-mode tokens when Whisper mishears the opener
 * (凍てつく地面 → 傷つく地面), so the run latches onto its LAST glyph (走) far too
 * late.  Scan consecutive glyphs for a bigram from the run's first few characters
 * (つく / 地面) and return that onset.  Returns null in segment mode (whole-phrase
 * tokens never form a 2-char bigram match). */
function findRunStartByEarlyGlyphs(
  runText: string,
  tailWords: readonly TranscriptWord[],
  searchLo: number,
  searchHi: number,
): number | null {
  const early = normalizeForMatch(runText).slice(0, 8)
  if (early.length < 2) return null
  const seq = tailWords
    .filter((w) => w.startTime >= searchLo && w.startTime < searchHi)
    .map((w) => ({ g: normalizeForMatch(w.word), t: w.startTime }))
    .filter((x) => x.g.length > 0 && x.g.length <= 2)
  for (let k = 0; k + 1 < seq.length; k++) {
    const bigram = (seq[k].g + seq[k + 1].g).slice(0, 2)
    if (bigram.length === 2 && early.includes(bigram)) return seq[k].t
  }
  return null
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

  // Word mode: if the opener glyph was misheard the loop above anchors runStart to
  // the run's LATE glyphs (走); recover the true onset from its opening bigram.
  const earlyStart = findRunStartByEarlyGlyphs(
    run.original,
    tailWords,
    entwined.startTime + 0.3,
    runStart,
  )
  if (earlyStart != null) runStart = Math.min(runStart, earlyStart)

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

const KANJI_RE = /[一-龯]/
/** Fold katakana onto hiragana so a katakana lyric (ローリング) matches a hiragana
 * transcript (ろう) and vice-versa. */
function kanaFold(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** Snap an adjacent-line boundary to the real glyph transition in the transcript.
 * Repeated kana (…向こう vs 此処 — both こ) or a katakana lyric against a hiragana
 * transcript (ローリング → ろう) make the LCS split two lines a beat late, so a line
 * loses its closing syllable (何を間違った…んだ) or starts inside the previous one
 * (此処 starting 1.3 s late).  The true boundary is where the previous line's LAST
 * kana is immediately followed by this line's onset — find that adjacent glyph pair
 * within ~2.5 s of the current split and snap both sides to it.  When this line
 * opens on a kanji (no phonetic glyph to match) it anchors on the previous line's
 * last kana alone.  Word-mode only: segment chunks never form the adjacent pair.
 *
 * The chosen glyph pair can be an interior repeat of the same kana rather than the
 * true boundary, snapping to a transition *inside* a line's own matched span: it
 * clipped my-eyes-only "I promise for my eyes only" ~0.5 s early and started
 * veil "温まることない痛みと" ~1.06 s late (D2).  Guard the snap with each line's
 * own reliably-matched span: never push this line's start past its first sung
 * glyph, and never pull the previous line's end before its last sung glyph. */
const GLYPH_SNAP_SPAN_TOL_S = 0.35
function snapBoundaryToGlyphTransition(
  lines: TimedLine[],
  words: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const spans = computeLineMatchedSpans(
    lines.map((l) => l.original || l.translation),
    clean,
  )
  const out = lines.map((l) => ({ ...l }))
  for (let i = 1; i < out.length; i++) {
    const prevLast = kanaFold(normalizeForMatch(out[i - 1].original)).slice(-1)
    const thisFirst = kanaFold(normalizeForMatch(out[i].original)).slice(0, 1)
    if (!prevLast || !thisFirst || KANJI_RE.test(prevLast)) continue
    const cur = out[i].startTime
    const onsetIsKanji = KANJI_RE.test(thisFirst)
    let best: number | null = null
    for (let k = 0; k + 1 < clean.length; k++) {
      const b = clean[k + 1]
      if (b.startTime < cur - 2.5) continue
      if (b.startTime > cur + 2.5) break
      const a = kanaFold(normalizeForMatch(clean[k].word))
      const bn = kanaFold(normalizeForMatch(b.word))
      if (a.endsWith(prevLast) && (onsetIsKanji || bn.startsWith(thisFirst))) {
        if (best === null || Math.abs(b.startTime - cur) < Math.abs(best - cur)) best = b.startTime
      }
    }
    // Reject a snap only when it would *introduce* a defect the pre-snap boundary
    // did not have: it starts this line after its own first sung glyph (when the
    // current start did not), or ends the previous line before its own last sung
    // glyph (when the current end did not). This leaves snaps that repair an
    // already-off boundary untouched. Low-coverage spans are ignored (unreliable).
    const thisSpan = spans[i]
    const prevSpan = spans[i - 1]
    const prevEndCur = out[i - 1].endTime
    const startsAfterOwnOnset =
      thisSpan != null
      && thisSpan.matchedChars / Math.max(1, thisSpan.totalChars) >= 0.5
      && best !== null
      && best - thisSpan.firstTime > GLYPH_SNAP_SPAN_TOL_S
      && cur - thisSpan.firstTime <= GLYPH_SNAP_SPAN_TOL_S
    const endsBeforeOwnOffset =
      prevSpan != null
      && prevSpan.matchedChars / Math.max(1, prevSpan.totalChars) >= 0.5
      && best !== null
      && prevSpan.lastEndTime - best > GLYPH_SNAP_SPAN_TOL_S
      && prevSpan.lastEndTime - prevEndCur <= GLYPH_SNAP_SPAN_TOL_S
    if (
      best !== null
      && Math.abs(best - cur) > 0.3
      && best > out[i - 1].startTime + 0.5
      && best < (out[i + 1]?.startTime ?? Infinity)
      && !startsAfterOwnOnset
      && !endsBeforeOwnOffset
    ) {
      out[i - 1].endTime = best
      out[i].startTime = best
    }
  }
  return out
}

/** A line end that falls strictly inside a sung transcript word clips that
 * word's tail out of the highlight/AB-loop. It happens when Whisper mishears
 * the line's final syllable (veil 届かないままの景色と → …景色を), so the LCS span
 * ends a char early and no tail-tuner has an anchor to extend to. When the
 * straddled word cannot belong to the next line (it ends at/before the next
 * line's start), the whole word is this line's audio — extend the end to the
 * word's edge. Word-mode scale only: phrase-length segment chunks (> 2.5 s)
 * are skipped, mirroring the boundary-metric cap, so a merged segment phrase
 * never drags a line end across its neighbours' text. */
const MID_WORD_EXTEND_MAX_WORD_S = 2.5
const MID_WORD_EXTEND_MARGIN_S = 0.1
function extendLineEndOutOfMidWord(
  lines: TimedLine[],
  words: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const line = out[i]
    const nextStart = out[i + 1]?.startTime ?? Infinity
    for (const w of clean) {
      const dur = w.endTime - w.startTime
      if (dur <= MID_WORD_EXTEND_MARGIN_S * 2 || dur > MID_WORD_EXTEND_MAX_WORD_S) continue
      if (w.startTime > line.endTime) break
      const inside =
        line.endTime > w.startTime + MID_WORD_EXTEND_MARGIN_S
        && line.endTime < w.endTime - MID_WORD_EXTEND_MARGIN_S
      if (!inside) continue
      // Only claim the word when it starts within this line's window and ends
      // before the next line begins — otherwise ownership is ambiguous.
      if (w.startTime >= line.startTime && w.endTime <= nextStart + 0.05) {
        line.endTime = Math.min(w.endTime, nextStart === Infinity ? w.endTime : nextStart)
      }
      break
    }
  }
  return out
}

/** Pull a line's start back to a fresh vocal onset it currently begins after.
 * When Whisper mishears a line's opening (理由→わけ) the LCS can't anchor the first
 * syllable, so the line starts a beat or two into its own audio — bad for looping.
 * A transcript glyph that follows a silence gap (no vocal just before) and sits
 * after the previous line's end is this line's true onset; snap to it. */
function backfillLineStartsToVocalOnset(
  lines: TimedLine[],
  words: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const SILENCE = 1.0
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const prevEnd = i > 0 ? out[i - 1].endTime : 0
    const start = out[i].startTime
    let onset: number | null = null
    for (const w of clean) {
      if (w.startTime <= prevEnd + 0.25) continue
      if (w.startTime > start + 0.05) break
      const precededByVocal = clean.some(
        (v) => v.startTime < w.startTime && v.endTime > w.startTime - SILENCE,
      )
      if (!precededByVocal) {
        onset = w.startTime
        break
      }
    }
    // Only a modest correction (0.5–2.5 s). A larger gap means the onset glyph
    // belongs to another line (e.g. an interjection the previous row left behind),
    // not a late-anchored start of this one.
    if (onset != null && start - onset > 0.5 && start - onset < 2.5) {
      out[i].startTime = Math.max(onset, prevEnd)
    }
  }
  return out
}

/** Reliable-span coverage floor — matches boundaryMetrics MIN_SPAN_COVERAGE
 * (the metric's own "well-matched line" gate), stricter than the glyph-snap
 * guard because this tuner moves boundaries on span evidence alone. */
const LATESTART_SPAN_MIN_COVERAGE = 0.55
/** Matches the boundary-metric lateStart threshold (boundaryMetrics.mjs). */
const LATESTART_MIN_PULL_S = 0.35
/** Corrections above this belong to another defect class (verse cascade /
 * transcript garble), not a late-anchored start — leave those alone. */
const LATESTART_MAX_PULL_S = 2.5

/** Pull a line's start back to its own reliably-matched span (D3 late-starts).
 * The silence-gap backfill above only fires when the onset follows >= 1s of
 * silence; inside continuous singing the LCS span itself is the evidence — a
 * well-covered line whose assigned start sits well after its first matched
 * glyph is late, full stop. Ownership guard: never pull into audio the
 * previous line's own matched span still claims. */
function backfillLateStartsToMatchedSpan(
  lines: TimedLine[],
  words: TranscriptWord[],
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const spans = computeLineMatchedSpans(
    lines.map((l) => l.original || l.translation),
    clean,
  )
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const span = spans[i]
    if (!span) continue
    if (span.matchedChars / Math.max(1, span.totalChars) < LATESTART_SPAN_MIN_COVERAGE) continue
    const late = out[i].startTime - span.firstTime
    if (late <= LATESTART_MIN_PULL_S || late >= LATESTART_MAX_PULL_S) continue
    const prevSpanEnd = i > 0 ? spans[i - 1]?.lastEndTime ?? -Infinity : -Infinity
    // The evidence must be word-scale: the first matched char's containing
    // transcript word gives a real acoustic edge to snap to, and the word must
    // not be partly the previous line's audio (per its matched span). Long
    // segment chunks only carry interpolated char times — too weak to move a
    // boundary on (and the reading pass depends on these windows).
    const container = clean.find((w) => w.startTime <= span.firstTime && w.endTime > span.firstTime)
    if (!container || container.endTime - container.startTime > LATESTART_MAX_PULL_S) continue
    if (container.startTime < prevSpanEnd - 0.05) continue
    const target = container.startTime
    // Pass-2 lines abut, so a late start means the previous line's end
    // overshoots into this line's audio — move the shared boundary, never
    // before the previous line's own matched content, and never squashing
    // the previous line below a visible duration.
    const prevFloor = i > 0 ? out[i - 1].startTime + 0.3 : 0
    let boundary = Math.max(target, prevSpanEnd, prevFloor)
    // A boundary strictly inside a short sung word would clip that word
    // (bnd_midword): move out to the word's start when this line owns it,
    // otherwise leave the line alone.
    const straddled = clean.find((w) => {
      const dur = w.endTime - w.startTime
      return dur >= 0.4 && dur <= 2.5 && boundary > w.startTime + 0.05 && boundary < w.endTime - 0.05
    })
    if (straddled) {
      if (straddled.startTime >= Math.max(prevSpanEnd, prevFloor) - 0.05) {
        boundary = Math.max(straddled.startTime, prevFloor)
      } else {
        continue
      }
    }
    if (boundary >= out[i].startTime) continue
    out[i].startTime = boundary
    if (i > 0 && out[i - 1].endTime > boundary) out[i - 1].endTime = boundary
  }
  return out
}

/** Latin-script lines Whisper misheard fail the lexical LCS but usually keep
 * their consonant frame. For each still-unanchored Latin line, search the
 * window between its neighbours for the best phonetic-skeleton match and
 * re-time onto it. Threshold-gated (>= PHONETIC_ANCHOR_MIN_SIMILARITY) so
 * clean songs are untouched. Returns the re-timed lines plus a recovered mask
 * (used later to upgrade quality to at most 'approximate').
 *
 * Ownership guard: a recovered anchor must never crowd out the previous
 * line's own reliably-matched span (computeLineMatchedSpans), even when that
 * line's currently-assigned timing sits elsewhere (e.g. itself mis-anchored)
 * — otherwise enforceLineMonotonicity would clip the previous line down to a
 * sliver to make room. If pulling the previous line back to its own span would
 * still compress it below the floor (its own start is itself too late), skip
 * this recovery rather than trade one degenerate line for another; the later
 * redistribution pass still spreads the skipped line across its run. */
function recoverLatinLinesByPhoneticAnchor(
  lines: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
): { lines: TimedLine[]; recovered: boolean[] } {
  const out = lines.map((l) => ({ ...l }))
  const recovered = out.map(() => false)
  const clean = sanitizeTranscript(words)
  if (clean.length === 0) return { lines: out, recovered }
  const lastTime = clean[clean.length - 1].endTime
  const spans = computeLineMatchedSpans(
    out.map((l) => l.original || l.translation),
    clean,
  )

  for (let i = 0; i < out.length; i++) {
    const text = out[i].original || out[i].translation
    if (!text.trim()) continue
    if (/[぀-ヿ㐀-鿿]/.test(text)) continue // JA lines: lexical matching owns these
    const prevEnd = i > 0 ? out[i - 1].endTime : 0
    const nextStart = i + 1 < out.length ? out[i + 1].startTime : lastTime
    const windowWords = transcriptWindowForLine(
      clean, out[i], prevEnd, nextStart, lastTime,
      LINE_VALIDATE_WINDOW_LEAD_S, LINE_VALIDATE_WINDOW_TAIL_S,
    )
    if (scoreLineAlignment(text, windowWords, sourceLanguage).quality === 'good') continue
    const anchor = findPhoneticAnchorEn(text, clean, Math.max(0, prevEnd - 2), Math.min(lastTime, nextStart + 2))
    if (!anchor) continue
    const prevSpan = i > 0 ? spans[i - 1] : undefined
    if (prevSpan && anchor.startTime < prevSpan.lastEndTime - 0.05) continue
    const nextSpanStart = i + 1 < out.length ? spans[i + 1]?.firstTime ?? Infinity : Infinity
    if (anchor.endTime > nextSpanStart + 0.05) continue
    // The previous line's currently-assigned end may overrun its own matched
    // span (itself mis-anchored) into the space this anchor now claims —
    // enforceLineMonotonicity would otherwise clip the previous line to a
    // sliver to make room. Pull it back to its own evidence instead, but only
    // if that leaves the previous line above the compression floor; if the
    // previous line's own start is itself too late to make room, skip this
    // recovery rather than trade one degenerate line for another.
    //
    // Only applies when the previous line HAS a reliable matched span: a line
    // with no lexical span has no evidence-based ownership claim to the
    // disputed region (it's itself unanchored — a run of consecutive misheard
    // lines is the tuner's main case), so it must not block this recovery; the
    // downstream redistribution pass re-times it.
    if (prevSpan && out[i - 1].endTime > anchor.startTime) {
      const prevText = out[i - 1].original || out[i - 1].translation
      const prevTarget = Math.max(prevSpan.lastEndTime, out[i - 1].startTime + 0.3)
      const prevDur = Math.min(prevTarget, anchor.startTime) - out[i - 1].startTime
      if (prevDur < minLineDuration(prevText) * 0.55) continue
      out[i - 1].endTime = prevTarget
    }
    out[i].startTime = anchor.startTime
    out[i].endTime = anchor.endTime
    recovered[i] = true
  }
  enforceLineMonotonicity(out)
  return { lines: out, recovered }
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
    // Subdivide multi-glyph chunks in the window into char-level slots so a short
    // merged chunk (…わからないんだロリー) splits by glyph position instead of handing
    // the whole chunk to one line. Long chunks are already subdivided by sanitize.
    const windowWords = clean
      .filter((w) => w.endTime > windowStart && w.startTime < windowEnd)
      .flatMap((w) =>
        w.endTime - w.startTime > 1.2 && [...normalizeForMatch(w.word)].length > 2
          ? subdivideTranscriptWord(w)
          : [w],
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
    // Each member line has its own reliable matched span within the window. The
    // group redistribution recomputes timings from a group-level LCS window and
    // can push a member's boundary out to the group envelope, overshooting the
    // member's true onset/offset (guitar-loneliness-segment L4/L7 lateStart,
    // L30 earlyEnd). Respect the member's own span: only accept a redistributed
    // boundary when it does not sit further from that span than the pre-realign
    // timing already did (beyond a small tolerance).
    const memberSpans = computeLineMatchedSpans(texts, windowWords)
    const RESPECT_TOL_S = 0.35
    // A member span needs enough matched coverage before it can pull a boundary
    // *earlier* (toward an onset the LCS may have mis-anchored to a later repeat);
    // a 2-of-5-char coincidence (a repetition line spuriously matching a
    // neighbour's audio) is not trustworthy for that.
    const MIN_RESPECT_COVERAGE = 0.5
    for (let k = 0; k < group.length; k++) {
      const span = memberSpans[k]
      const cov = span && span.totalChars > 0 ? span.matchedChars / span.totalChars : 0
      const reliable = span != null && cov >= MIN_RESPECT_COVERAGE
      const priorStart = out[lo + k].startTime
      const priorEnd = out[lo + k].endTime
      let nextStart = refined.lines[k].startTime
      let nextEnd = refined.lines[k].endTime
      if (span && reliable) {
        // A redistributed start later than the member's own first sung glyph is a
        // lateStart; revert to the (validated) prior start when it tracked the
        // span more closely.
        if (
          nextStart - span.firstTime > RESPECT_TOL_S
          && nextStart - span.firstTime > priorStart - span.firstTime
        ) {
          nextStart = priorStart
        }
        // A redistributed end earlier than the member's own last sung glyph is an
        // earlyEnd; revert to the prior end when it tracked the span more closely.
        if (
          span.lastEndTime - nextEnd > RESPECT_TOL_S
          && span.lastEndTime - nextEnd > span.lastEndTime - priorEnd
        ) {
          nextEnd = priorEnd
        }
      } else {
        // No reliable own span in the group window: the group-level LCS can
        // re-anchor this member to a *later repeat* of the same phrase and shove
        // its boundary well off its validated position, then monotonicity
        // cascades that shift onto the following well-matched lines
        // (guitar-loneliness-segment: L3 27.0→33.1 and L6 38.2→43.1 over-shift,
        // dragging L4/L7 lateStart and clipping L30's tail via an early-dragged
        // L31). A low-confidence re-anchor is less trustworthy than the validated
        // timing, so keep the validated boundary whenever the redistribution
        // moved it more than the tolerance.
        if (Math.abs(nextStart - priorStart) > RESPECT_TOL_S) nextStart = priorStart
        if (Math.abs(nextEnd - priorEnd) > RESPECT_TOL_S) nextEnd = priorEnd
      }
      out[lo + k].startTime = nextStart
      out[lo + k].endTime = nextEnd
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
// Below this span, an interjection line reads as a zero-duration flash rather
// than a visible lyric — reject a chunk reassignment that would produce one
// (short Whisper filler tokens like "'ll" near EN-vocalization interjection
// runs otherwise collapse the line almost to a point).
const MIN_INTERJECTION_SPAN_S = 0.12

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

    // Case C: the interjection's own held vowel (ああ / あー) is sung LATER than
    // where the LCS anchored it — a breath then a drawn-out "ahh". Snap to it.
    const vowel = clean.find(
      (w) =>
        w.startTime > interjStart + 0.3
        && w.startTime < nextStart - 0.1
        && /^[あぁーア]+$/.test(normalizeForMatch(w.word)),
    )
    if (vowel) {
      if (out[i - 1].endTime > vowel.startTime) out[i - 1].endTime = vowel.startTime - 0.05
      out[i].startTime = vowel.startTime
      out[i].endTime = Math.min(nextStart - 0.05, vowel.startTime + 2.5)
      continue
    }

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

  // A tight run of consecutive interjection/vocalization lines (e.g. 5 EN
  // ad-lib lines packed into ~2s) can leave individual lines with a
  // near-zero span once each has snapped to its own short Whisper chunk.
  // Redistribute the run's total window evenly across its lines so every
  // line gets at least a visible floor span where the window supports it —
  // fixing a single line in isolation can't work when its neighbour has
  // already claimed the room right after it.
  for (let i = 1; i < out.length; ) {
    if (!isInterjectionLyricLine(out[i].original || out[i].translation)) {
      i++
      continue
    }
    let j = i
    while (
      j + 1 < out.length
      && isInterjectionLyricLine(out[j + 1].original || out[j + 1].translation)
    ) {
      j++
    }
    const runLen = j - i + 1
    const windowStart = out[i].startTime
    // Bound the window by where the run's own lines already reached, not by
    // the following line's startTime — a downstream needs_review line can be
    // anchored far away and would otherwise donate an unrelated multi-second
    // gap to this run instead of just enough room for a visible floor span.
    const naturalEnd = out[j].endTime
    const nextLineStart = j + 1 < out.length ? out[j + 1].startTime : naturalEnd
    const windowEnd = Math.min(
      Math.max(naturalEnd, windowStart + runLen * MIN_INTERJECTION_SPAN_S),
      nextLineStart,
    )
    const windowSpan = windowEnd - windowStart
    const needsFix = Array.from({ length: runLen }, (_, k) => i + k)
      .some((idx) => out[idx].endTime - out[idx].startTime < MIN_INTERJECTION_SPAN_S)
    // Redistribute only when the floor is actually achievable: a window
    // smaller than runLen × floor would hand each line a share below the
    // 0.01s inter-line gap and produce negative-duration lines.
    if (needsFix && windowSpan >= runLen * MIN_INTERJECTION_SPAN_S) {
      const share = windowSpan / runLen
      for (let k = 0; k < runLen; k++) {
        const idx = i + k
        out[idx].startTime = windowStart + k * share
        out[idx].endTime = windowStart + (k + 1) * share - (k === runLen - 1 ? 0 : 0.01)
      }
    }
    i = j + 1
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
    // A line that solely owns a long transcript chunk (e.g. 赤い…乗せて, ~12 s) must
    // be allowed to extend to that chunk's end; the flat +3.5 s cap alone clips it.
    // Still bounded by nextStart, so it can never bleed into the following line.
    const ownedEnd = findExclusiveChunk(out[i], clean, out)?.endTime ?? -Infinity
    const maxEnd = runFollows
      ? Math.min(lastTime, out[i + 1].startTime + 2.5, out[i].endTime + 5)
      : Math.min(lastTime, nextStart - 0.05, Math.max(out[i].endTime + 3.5, ownedEnd))
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
    // Word-mode Whisper often fails to transcribe 心絡まって — the LCS then anchors
    // the line to a late ローリング chunk, leaving a large gap after the previous line.
    // Snap the start back to fill the gap so rebalanceEntwinedRunPair has the
    // correct anchor window to work from.
    if (i > 0 && out[i].startTime - out[i - 1].endTime > 1.0) {
      out[i].startTime = out[i - 1].endTime
    }
    // Floor for the 心絡まって / 凍てつく boundary: how long 心絡まって is actually
    // sung.  Use the first healthy chorus pair's observed 心絡まって duration as a
    // direct offset from this line's start — a stable, physical estimate.  A
    // fraction of the *combined* pair span (previous approach) overshoots here
    // because the second chorus's run line (凍てつく世界) is longer, inflating the
    // window and pushing the boundary past the true onset.  Fall back to 3.5 s.
    let refEntwinedDur = 3.5
    for (let j = 0; j < i; j++) {
      if (!ENTWINED_ROLLING_RE.test(out[j].original)) continue
      if (j + 1 >= out.length || !RUN_LINE_RE.test(out[j + 1].original)) continue
      const refSpan = out[j].endTime - out[j].startTime
      // Only trust a plausible sung duration (< 20 s); a run line over-extended to
      // cover an instrumental break would poison the estimate.
      if (refSpan > 1.5 && refSpan < 20) {
        refEntwinedDur = refSpan
        break
      }
    }
    // proportionalFloor guards against garbage words in rebalanceEntwinedRunPair
    // in BOTH segment mode (split fires) and word mode (split doesn't fire but the
    // shared >= 3 false-positive still pulls runStart into 心絡まって's span).  Cap
    // at the run line's own start so the floor can never push past the pair.
    const proportionalFloor = Math.min(
      out[i].startTime + refEntwinedDur,
      out[i + 1].endTime - 0.5,
    )

    // Segment-mode collapse: 心絡まって has near-zero duration — seed a split so
    // rebalanceEntwinedRunPair receives a real endTime to work from.
    if (out[i].endTime < out[i].startTime + 1.5 && out[i + 1].endTime > out[i + 1].startTime + 2.0) {
      out[i].endTime = proportionalFloor
      out[i + 1].startTime = proportionalFloor
    }
    const { runStart, runEnd } = rebalanceEntwinedRunPair(
      out[i],
      out[i + 1],
      clean,
      lastTime,
    )
    // Always floor at the proportional estimate — garbage words can pull runStart
    // below it regardless of whether the segment-mode split fired above.
    const effectiveRunStart = Math.max(runStart, proportionalFloor)
    // 心絡まって ローリング flows straight into 凍てつく with no rest, so butt its end
    // against the run onset — this also reclaims the trailing ローリング glyphs the
    // LCS left short (心絡まって ending at 160.4 while ロリー runs to ~161.6).
    out[i].endTime = Math.max(out[i].startTime + 0.08, effectiveRunStart)
    out[i + 1].startTime = effectiveRunStart
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

export function transcriptWindowForLine(
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
/** Rough lower bound on a line's sung duration from its glyph count — used to
 * reject retry results that collapse a plausible span onto a few matched glyphs. */
function minSungSpan(lineText: string): number {
  const glyphs = normalizeForMatch(lineText).length
  return Math.max(0.8, Math.min(4.5, glyphs * 0.14))
}

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
        // A re-align in isolation can latch onto a high-coverage sliver when
        // Whisper misheard most of the line (word-mode 君の孤独 → 全て…出す only),
        // collapsing a well-formed span. Accept a same-rank retry only when it
        // does not shrink an already-plausible span below the char-count floor.
        const curSpan = out[i].endTime - out[i].startTime
        const newSpan = retried.endTime - retried.startTime
        const collapses =
          curSpan >= minSungSpan(lineText) && newSpan < curSpan * 0.6 && newSpan < minSungSpan(lineText)
        const accept =
          newRank > oldRank
          || (newRank === oldRank && retried.score.coverage > score.coverage + 0.08 && !collapses)
        if (accept) {
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
        const curSpan = out[i].endTime - out[i].startTime
        const partialSpan = partial ? partial.endTime - partial.startTime : 0
        const partialCollapses =
          curSpan >= minSungSpan(lineText) && partialSpan < curSpan * 0.6 && partialSpan < minSungSpan(lineText)
        if (partial && !partialCollapses) {
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
  tunedLines = snapLinesToOwnedChunks(tunedLines, words)
  tunedLines = extendValidatedLineTails(tunedLines, words)
  tunedLines = extendUndershotLinesWithPartialMatch(tunedLines, words, sourceLanguage)
  tunedLines = clipSilencePaddedLineTails(tunedLines, words)
  tunedLines = recoverInterjectionTiming(tunedLines, words)
  tunedLines = snapBoundaryToGlyphTransition(tunedLines, words)
  tunedLines = extendLineEndOutOfMidWord(tunedLines, words)
  tunedLines = backfillLineStartsToVocalOnset(tunedLines, words)
  tunedLines = backfillLateStartsToMatchedSpan(tunedLines, words)
  const phonetic = recoverLatinLinesByPhoneticAnchor(tunedLines, words, sourceLanguage)
  tunedLines = phonetic.lines
  const redist = redistributeDegenerateRuns(tunedLines, words, sourceLanguage)
  tunedLines = redist.lines
  tunedLines = expandSquashedLineHighlights(tunedLines)
  const quality = recomputeLineQuality(
    tunedLines,
    words,
    sourceLanguage,
    pass1.anchorSources,
  )

  // Whisper's segment transcript may not phonetically match repetition-only lines
  // (e.g. "ローリング ローリング") even when their timing is correct — Whisper merges
  // them into neighbouring lyric text.  Upgrade needs_review → approximate for any
  // repetition-only line that has a reasonable span and is sandwiched between two
  // good-quality anchors: the neighbours constrain the position well enough.
  const lineAlignmentQuality = [...quality.lineAlignmentQuality]
  for (let i = 1; i < tunedLines.length - 1; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    if (!isRepetitionOnlyLine(lineTexts[i])) continue
    const span = tunedLines[i].endTime - tunedLines[i].startTime
    if (span < REPETITION_REF_MIN_SPAN_S) continue
    if (lineAlignmentQuality[i - 1] === 'good' && lineAlignmentQuality[i + 1] === 'good') {
      lineAlignmentQuality[i] = 'approximate'
    }
  }

  // Interjection/vocalization lines (JA 嗚呼…, EN "Ahh, ooh-hmm…") have no
  // phonetic content a JA transcript can anchor; review can't improve them.
  // They keep interpolated timing and read as approximate, not needs_review.
  for (let i = 0; i < tunedLines.length; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    if (isInterjectionLyricLine(lineTexts[i])) lineAlignmentQuality[i] = 'approximate'
  }

  // Partial-anchor upgrade (class B, findings §rows 9/11): a needs_review line
  // whose reliable matched span is small but REAL — several verbatim chars at
  // minimum coverage, time-consistent with the assigned window, and flanked by
  // lines that themselves aren't in review — is placed correctly even though
  // its matched fraction sits below the classifier floor. Review can't improve
  // it, so it reads approximate.
  const upgradeSpans = computeLineMatchedSpans(lineTexts, transcriptWords)
  for (let i = 0; i < tunedLines.length; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    const s = upgradeSpans[i]
    if (!s || s.matchedChars < 4) continue
    if (s.matchedChars / Math.max(1, s.totalChars) < 0.3) continue
    if (s.firstTime < tunedLines[i].startTime - 0.5) continue
    if (s.lastEndTime > tunedLines[i].endTime + 0.5) continue
    const prevOk = i === 0 || lineAlignmentQuality[i - 1] !== 'needs_review'
    const nextOk = i === tunedLines.length - 1 || lineAlignmentQuality[i + 1] !== 'needs_review'
    if (prevOk && nextOk) lineAlignmentQuality[i] = 'approximate'
  }

  // Redistributed lines that landed on transcript activity have plausible,
  // evidence-adjacent timing; review can't do better than the redistribution
  // already did, so they read approximate. Off-activity placements stay flagged.
  for (let i = 0; i < tunedLines.length; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    if (redist.redistributed[i] && redist.onActivity[i]) lineAlignmentQuality[i] = 'approximate'
  }

  // Phonetically-recovered lines sit on real (misheard) audio — approximate.
  for (let i = 0; i < tunedLines.length; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    if (phonetic.recovered[i]) lineAlignmentQuality[i] = 'approximate'
  }

  const syncedPhrases = syncPhrasesFromValidatedLines(phrases, tunedLines)

  return {
    lines: tunedLines,
    phrases: syncedPhrases,
    report,
    mode: pass1.mode,
    confidence: pass1.confidence,
    anchorSources: quality.anchorSources,
    lineAlignmentQuality,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}
