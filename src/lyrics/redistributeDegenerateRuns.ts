import type { AlignmentLanguage, TimedLine } from '../core/types'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import {
  computeLineMatchedSpans,
  isInterjectionLyricLine,
  normalizeForMatch,
  scoreLineAlignment,
} from '../ai-pipeline/contentAligner'
import {
  transcriptWindowForLine,
  LINE_VALIDATE_WINDOW_LEAD_S,
  LINE_VALIDATE_WINDOW_TAIL_S,
} from './phraseAlignment'
import {
  expectedLineDuration,
  minLineDuration,
  findActivityRegions,
  COMPRESSION_FRACTION,
} from './lineDegeneracy'

/** Consecutive starts closer than this are a pileup. */
const PILEUP_GAP_S = 0.4
/** A span over max(18s, 2.5× expected) is an absorption. */
const ABSORPTION_FACTOR = 2.5
const ABSORPTION_MIN_S = 18
/** Redistributed lines never stretch beyond 1.5× their expected duration. */
const MAX_STRETCH = 1.5
/**
 * A degenerate run is packed onto a transcript-activity region only when the
 * region's words lexically corroborate at least this fraction of the RUN's
 * expected characters (matched chars / total run chars, via the same char-LCS +
 * MIN_RELIABLE_RUN coincidence filter the aligner anchors on — computeLine
 * MatchedSpans). No acoustic/VAD/confidence signal exists on the re-refine path,
 * so lexical corroboration is the only usable signal. The framing is RUN-
 * coverage, not region-coverage: a lone `ような` blip covers 67% of its own
 * region but only ~2% of the run. AKFG garbled-fixture separation — instrumental
 * noise 0.00, a lone `ような` blip 0.023, a healthy vocal region 0.74 — so any
 * threshold in [0.05, 0.5] splits cleanly; 0.15 sits central with a ~5× margin
 * below the healthy floor. */
const RUN_COVERAGE_MIN = 0.15
/**
 * Density OR-clause guarding the lexical gate against cross-script false
 * negatives (a region is also kept when its words can't be char-matched but it
 * is plainly a real vocal stretch): a region qualifies when it carries at least
 * this much actual transcribed audio (summed word/segment durations). The
 * signal is audio-TIME, not word count — in segment-mode transcripts a real
 * vocal region is often a SINGLE long segment (stranger-than-heaven's mixed
 * two-pass: one 8s "Stranger than heaven" segment), so a word-count floor would
 * wrongly reject it. Absolute time, not a fraction of the run, so a real region
 * is not penalised for sitting inside a long un-anchorable run (autolang's
 * 55-line proportional run). Corpus separation across every stranger config
 * (English/mixed lyric, JA-mode transcript): real vocal regions carry 2.0–27.1s
 * of audio, while every instrumental blip that must stay rejected (AKFG `ような`
 * and lone song-edge artifacts) carries ≤1.2s. */
const DENSE_REGION_MIN_WORD_TIME_S = 1.5

export interface RedistributionResult {
  lines: TimedLine[]
  /** True where the pass re-timed the line. */
  redistributed: boolean[]
  /** True where the re-timed span overlaps transcript activity at no less
   * than COMPRESSION_FRACTION of the line's floor — the needs_review →
   * approximate upgrade gate (a sliver on a noise blip must stay flagged). */
  onActivity: boolean[]
}

function lineTextOf(l: TimedLine): string {
  return l.original || l.translation
}

function runIsDegenerate(
  lines: TimedLine[],
  from: number,
  to: number,
  sourceLanguage: AlignmentLanguage,
): boolean {
  for (let k = from; k <= to; k++) {
    const text = lineTextOf(lines[k])
    if (!text.trim()) continue
    const dur = lines[k].endTime - lines[k].startTime
    if (dur < minLineDuration(text) * COMPRESSION_FRACTION) return true
    const ceiling = Math.max(ABSORPTION_MIN_S, expectedLineDuration(text, sourceLanguage) * ABSORPTION_FACTOR)
    if (dur > ceiling) return true
    if (k > from && lines[k].startTime - lines[k - 1].startTime < PILEUP_GAP_S) return true
  }
  return false
}

/**
 * Final graceful-degradation tuner. Whisper can miss whole sections (misheard
 * vocals, overlapping vocalists, effects), leaving runs of unanchorable lines
 * that the earlier passes cram into a point (pileup), squeeze to slivers
 * (compression), or stretch across an instrumental (absorption). Re-time each
 * degenerate run across the transcript activity between its anchored
 * neighbours, proportional to each line's expected sung duration; instrumental
 * gaps (>4s without words) are never claimed. Anchored ('good') lines are
 * never moved.
 *
 * `anchoredMask[i] === true` marks a line as anchored regardless of its
 * lexical score — used for phonetically-recovered lines, which are lexically
 * needs_review by definition (Whisper misheard them) but sit on evidence-backed
 * placement that redistribution must work around, not over.
 */
export function redistributeDegenerateRuns(
  linesIn: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: AlignmentLanguage,
  anchoredMask?: boolean[],
): RedistributionResult {
  const lines = linesIn.map((l) => ({ ...l }))
  const redistributed = lines.map(() => false)
  const onActivity = lines.map(() => false)
  const clean = sanitizeTranscript(words)
  if (clean.length === 0 || lines.length === 0) return { lines, redistributed, onActivity }
  const lastTime = clean[clean.length - 1].endTime

  const anchored = lines.map((l, i) => {
    if (anchoredMask?.[i]) return true
    const text = lineTextOf(l)
    if (!text.trim()) return true // blank rows are never redistributed
    const prevEnd = i > 0 ? lines[i - 1].endTime : 0
    const nextStart = i + 1 < lines.length ? lines[i + 1].startTime : lastTime
    const windowWords = transcriptWindowForLine(
      clean, l, prevEnd, nextStart, lastTime,
      LINE_VALIDATE_WINDOW_LEAD_S, LINE_VALIDATE_WINDOW_TAIL_S,
    )
    return scoreLineAlignment(text, windowWords, sourceLanguage).quality === 'good'
  })

  let i = 0
  while (i < lines.length) {
    if (anchored[i]) { i++; continue }
    let j = i
    while (j + 1 < lines.length && !anchored[j + 1]) j++
    redistributeRun(lines, i, j, clean, sourceLanguage, lastTime, redistributed, onActivity)
    i = j + 1
  }
  return { lines, redistributed, onActivity }
}

interface RunSpan {
  start: number
  end: number
}

/** Proportional-duration scale for a run: activity capacity (or the whole
 * window when there is no activity) over the run's expected total, capped at
 * MAX_STRETCH. */
function runScale(
  regions: { start: number; end: number }[],
  windowStart: number,
  windowEnd: number,
  weights: number[],
): number {
  const totalExpected = weights.reduce((a, b) => a + b, 0)
  const capacity = regions.reduce((a, r) => a + (r.end - r.start), 0)
  return Math.min(
    MAX_STRETCH,
    (regions.length > 0 ? capacity : windowEnd - windowStart) / totalExpected,
  )
}

/**
 * Lay the run out across the window: proportional durations floored per line,
 * preferring transcript-activity regions. The cursor advances toward the next
 * region when the current one lacks room — but never further than would leave
 * the remaining lines' floors unplaceable before the window end, so when
 * activity capacity cannot fit the floored durations the layout degrades to
 * spilling past region edges into the window (spread) instead of collapsing
 * lines into slivers or zero-width rows at a region boundary. A line that
 * started inside a region still clamps to the region's edge (never claiming
 * the instrumental after it) while the clamped span stays non-degenerate —
 * the genuine-capacity-limit carve-out below the full floor.
 */
function layoutRun(
  windowStart: number,
  windowEnd: number,
  regions: { start: number; end: number }[],
  weights: number[],
  floors: number[],
  regionClampFloor: number[],
): RunSpan[] {
  const scale = runScale(regions, windowStart, windowEnd, weights)
  const totalFloor = floors.reduce((a, b) => a + b, 0)
  // Anchor at the first activity, shifting earlier only as far as the floors need.
  const anchor = regions.length > 0 ? regions[0].start : windowStart
  let cursor = Math.max(windowStart, Math.min(anchor, windowEnd - totalFloor))
  // Σ floors of the lines after the current one: the space that must stay free.
  let remaining = totalFloor
  const spans: RunSpan[] = []
  let ri = 0
  for (let k = 0; k < weights.length; k++) {
    remaining -= floors[k]
    const dur = Math.max(weights[k] * scale, floors[k])
    while (ri < regions.length - 1 && regions[ri].end - cursor < dur) {
      const target = Math.min(regions[ri + 1].start, windowEnd - remaining - floors[k])
      if (target <= cursor) break
      cursor = target
      if (cursor < regions[ri + 1].start) break // partial snap into the gap
      ri++
    }
    let durEff = Math.min(dur, windowEnd - remaining - cursor)
    if (ri < regions.length && cursor >= regions[ri].start && cursor < regions[ri].end) {
      // Prefer ending at the region edge over claiming the instrumental after
      // it — but only down to the clamp floor; a tinier clamp is a sliver.
      const room = regions[ri].end - cursor
      if (room < durEff && room >= regionClampFloor[k]) durEff = room
    }
    spans.push({ start: cursor, end: cursor + durEff })
    cursor += durEff
  }
  return spans
}

function redistributeRun(
  lines: TimedLine[],
  from: number,
  to: number,
  clean: TranscriptWord[],
  sourceLanguage: AlignmentLanguage,
  lastTime: number,
  redistributed: boolean[],
  onActivity: boolean[],
): void {
  if (!runIsDegenerate(lines, from, to, sourceLanguage)) return
  const windowStart = from > 0 ? lines[from - 1].endTime : 0
  const windowEnd = to + 1 < lines.length ? lines[to + 1].startTime : lastTime
  if (windowEnd - windowStart < 0.5) return

  // Per-line packing floor: no re-timed line may fall below its plausible sung
  // minimum, capped at its fair share of the window so a crowded run still
  // fits. `regionClampFloor` is the region-edge clamp bound: a clamped line
  // may keep a genuine capacity limit down to the compression threshold, but
  // anything below that is a sliver and the line spills past the edge instead.
  const fairShare = (windowEnd - windowStart) / (to - from + 1)
  const weights: number[] = []
  const floors: number[] = []
  const regionClampFloor: number[] = []
  const runTexts: string[] = []
  for (let k = from; k <= to; k++) {
    const text = lineTextOf(lines[k])
    weights.push(expectedLineDuration(text, sourceLanguage))
    floors.push(Math.min(minLineDuration(text), fairShare))
    regionClampFloor.push(Math.min(fairShare, minLineDuration(text) * COMPRESSION_FRACTION))
    runTexts.push(text)
  }

  // Run-coverage lexical gate (round 7): keep only activity regions whose words
  // lexically corroborate the RUN's expected text above RUN_COVERAGE_MIN. This
  // rejects hallucinated/instrumental blips (a ♪ or a lone misheard mora that
  // findActivityRegions can't tell from real vocals) so a whole verse is never
  // clustered onto dead air. When the filter empties the set the layout falls
  // back to spreading the run across the whole window at floor with onActivity
  // false — an honest needs_review rather than a false approximate on noise.
  const totalRunChars = runTexts.reduce((a, t) => a + normalizeForMatch(t).length, 0)
  const regions = findActivityRegions(clean, windowStart, windowEnd).filter((r) => {
    if (totalRunChars === 0) return true
    const regionWords = clean.filter((w) => w.endTime > r.start && w.startTime < r.end)
    const spans = computeLineMatchedSpans(runTexts, regionWords)
    const matched = spans.reduce((a, s) => a + (s ? s.matchedChars : 0), 0)
    if (matched / totalRunChars >= RUN_COVERAGE_MIN) return true
    // Density OR-clause: the lexical gate is blind across scripts. When the
    // lyric is English (or mixed) but the transcript is JA-mode Whisper, the
    // real sung vocals come back as katakana that char-LCS can't match, so a
    // genuine vocal region scores near-zero coverage (stranger-than-heaven's
    // English verses: cov 0.02–0.13). Keep such a region when it carries real
    // transcribed audio (not a lone token in dead air). A hallucinated
    // instrumental blip is a single ≤1.2s word and fails both clauses (AKFG
    // `ような`: one word, 1s), so this exception protects cross-script vocals
    // without re-admitting the noise the lexical gate exists to reject.
    const wordTime = regionWords.reduce((a, w) => a + (w.endTime - w.startTime), 0)
    return wordTime >= DENSE_REGION_MIN_WORD_TIME_S
  })
  // Words inside the kept (corroborated) regions — the only activity the
  // onActivity → approximate upgrade may credit. A line merely passing over a
  // rejected blip must not be certified as sitting on real vocals.
  const activeWords = clean.filter((w) =>
    regions.some((r) => w.endTime > r.start && w.startTime < r.end))

  // A window the floored proportional durations over-subscribe is pure
  // flattening: every second an interjection filler row keeps is taken from a
  // lyric line's pacing. Interjections have no anchorable phonetic content and
  // their parenthetical annotations inflate the glyph floor, so in that regime
  // (only) they degrade to the compression-threshold floor.
  {
    const scale = runScale(regions, windowStart, windowEnd, weights)
    const wanted = weights.reduce((a, w, k) => a + Math.max(w * scale, floors[k]), 0)
    if (wanted > windowEnd - windowStart) {
      for (let k = from; k <= to; k++) {
        if (isInterjectionLyricLine(lineTextOf(lines[k]))) floors[k - from] = regionClampFloor[k - from]
      }
    }
  }

  const spans = layoutRun(windowStart, windowEnd, regions, weights, floors, regionClampFloor)

  for (let k = from; k <= to; k++) {
    const s = spans[k - from]
    lines[k].startTime = s.start
    lines[k].endTime = Math.max(s.end, s.start)
    redistributed[k] = true
    // Upgrade gate (round 6 C, diagnosis H4): word overlap alone must not
    // certify a placement — a sliver on a hallucinated blip is not
    // "approximate". The span must also keep the compression threshold of its
    // floor; region-edge clamps and interjection relief sit exactly at that
    // acceptance floor, hence >= with epsilon.
    const dur = lines[k].endTime - lines[k].startTime
    const wideEnough = dur >= minLineDuration(lineTextOf(lines[k])) * COMPRESSION_FRACTION - 1e-6
    onActivity[k] =
      wideEnough &&
      activeWords.some((w) => w.startTime < lines[k].endTime && w.endTime > lines[k].startTime)
  }
}
