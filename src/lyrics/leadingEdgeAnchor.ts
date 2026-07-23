import type { AlignmentLanguage, TimedLine } from '../core/types'
import { lineWeight } from '../ai-pipeline/aligner'
import { enforceLineMonotonicity } from './phraseAlignment'
import { nearestOnset, hasPreOnsetDip, voicedFraction, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'
import { computeLineMatchedSpans } from '../ai-pipeline/contentAligner'

const MIN_HIGHLIGHT_S = 1.2

/** Pin the opening lines to the detected first vocal onset and re-spread the
 * displaced leading lines (by singing weight) into the gap. Bidirectional:
 *  - Opening crammed BEFORE the onset (onto an instrumental intro): bound the
 *    re-spread with the first line already placed at/after the onset.
 *  - Opening shifted well AFTER the onset (interpolated late because the aligner
 *    found no content anchor for the intro): bound it with the first
 *    content-trusted line (a matched span) — REQUIRES `opts.spans`, since without
 *    them a displaced late opening is indistinguishable from a song that
 *    genuinely starts singing late. A first line that itself carries a content
 *    match is treated as trustworthy and left alone (never yanked to a false
 *    early onset). Start-only; conservative — no-op unless the first line is at
 *    least MIN_GAP off the onset AND a bounding line exists. Returns a new array. */
export function anchorLeadingEdge(
  lines: TimedLine[],
  onsetTime: number,
  sourceLanguage: AlignmentLanguage,
  opts?: { minGapSec?: number; spans?: ReturnType<typeof computeLineMatchedSpans>; minCoverage?: number },
): TimedLine[] {
  const MIN_GAP = opts?.minGapSec ?? 3.0
  const MIN_COV = opts?.minCoverage ?? 0.5
  const spans = opts?.spans
  const lineText = (l: TimedLine) => (l.original || l.translation).trim()
  const coverage = (i: number) => {
    const s = spans?.[i]
    return s ? s.matchedChars / Math.max(1, s.totalChars) : 0
  }

  const firstIdx = lines.findIndex((l) => lineText(l).length > 0)
  if (firstIdx === -1) return lines

  const displacement = lines[firstIdx].startTime - onsetTime // <0 crammed early, >0 late
  // First line already sits near the onset — nothing displaced.
  if (Math.abs(displacement) < MIN_GAP) return lines

  let boundIdx = -1
  if (displacement < 0) {
    // Crammed BEFORE the onset. But a content-matched opening is genuine early
    // vocals — the song starts singing, breaks to an instrumental, then re-enters
    // at `onset` — NOT interpolated intro-cram, so leave it where its content match
    // placed it. Symmetric to the displacement>0 content-trust guard below; without
    // it, a song that opens on vocals and then has a mid-intro instrumental gets its
    // opening yanked forward onto the later re-entry onset (e.g. line 0 pulled from
    // 0.5s to 23s when firstVocalOnset reports the verse entry rather than the true
    // leading edge).
    if (spans && coverage(firstIdx) >= MIN_COV) return lines
    // Crammed BEFORE the onset: bound with the first line at/after the onset.
    for (let j = firstIdx + 1; j < lines.length; j++) {
      if (lines[j].startTime >= onsetTime) {
        boundIdx = j
        break
      }
    }
  } else {
    // Shifted AFTER the onset. Needs content trust to separate a displaced
    // interpolated opening from a genuinely-late first sung line.
    if (!spans) return lines
    // A content-matched first line is trustworthy where it is — don't pull it back.
    if (coverage(firstIdx) >= MIN_COV) return lines
    for (let j = firstIdx + 1; j < lines.length; j++) {
      if (coverage(j) >= MIN_COV && lines[j].startTime >= onsetTime + MIN_GAP) {
        boundIdx = j
        break
      }
    }
  }
  if (boundIdx === -1) return lines // no bounding line — leave it alone

  const out = lines.map((l) => ({ ...l }))
  const span = out[boundIdx].startTime - onsetTime

  const weights: number[] = []
  let totalWeight = 0
  for (let i = firstIdx; i < boundIdx; i++) {
    const w = Math.max(1e-3, lineWeight(lineText(out[i]) || out[i].original || out[i].translation, sourceLanguage))
    weights.push(w)
    totalWeight += w
  }

  let cursor = onsetTime
  for (let i = firstIdx; i < boundIdx; i++) {
    out[i].startTime = cursor
    cursor += (span * weights[i - firstIdx]) / totalWeight
  }

  enforceLineMonotonicity(out)
  return out
}

const ACOUSTIC_MAX_PULL_S = 2.0
const ACOUSTIC_MIN_PULL_S = 0.3
const ACOUSTIC_SLACK_S = 0.15
const ACOUSTIC_ONSET_MIN_STRENGTH = 0.15
const ACOUSTIC_DIP_WINDOW_S = 0.5
const ACOUSTIC_DIP_MAX_ACTIVITY = 0.1
const ACOUSTIC_VOICED_RUN_MIN = 0.6
const ACOUSTIC_SNAP_MIN_COVERAGE = 0.3
const ACOUSTIC_MIX_CORROBORATE_TOL_S = 0.5

/**
 * Acoustic late-start corrector: pull a line's start back to the real
 * vocal-energy onset from the phase-1 envelope. The complement to the lexical
 * backfills (backfillLineStartsToVocalOnset / backfillLateStartsToMatchedSpan),
 * for cases they can't handle — garbled transcripts and interpolated segment
 * chunks. Late-starts-only, endTime-preserving, never crosses the previous line.
 * Stem-decisive; on a raw mix the onset must agree with the line's lexical onset
 * (span.firstTime) so a drum/synth transient can't move a boundary.
 */
export function backfillLateStartsToAcousticOnset(
  lines: TimedLine[],
  spans: ReturnType<typeof computeLineMatchedSpans>,
  sig: VocalActivitySignal,
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const span = spans[i]
    if (!span) continue
    const coverage = span.matchedChars / Math.max(1, span.totalChars)
    if (coverage < ACOUSTIC_SNAP_MIN_COVERAGE) continue

    const start = out[i].startTime
    const onset = nearestOnset(sig, start, {
      maxBefore: ACOUSTIC_MAX_PULL_S,
      slackAfter: ACOUSTIC_SLACK_S,
      minStrength: ACOUSTIC_ONSET_MIN_STRENGTH,
    })
    if (onset == null || start - onset < ACOUSTIC_MIN_PULL_S) continue
    if (!hasPreOnsetDip(sig, onset, { dipWindow: ACOUSTIC_DIP_WINDOW_S, dipMaxActivity: ACOUSTIC_DIP_MAX_ACTIVITY })) continue
    if (voicedFraction(sig, onset, start) < ACOUSTIC_VOICED_RUN_MIN) continue

    if (sig.source === 'mix' && Math.abs(span.firstTime - onset) > ACOUSTIC_MIX_CORROBORATE_TOL_S) continue

    const prevSpanEnd = i > 0 ? spans[i - 1]?.lastEndTime ?? -Infinity : -Infinity
    const prevFloor = i > 0 ? out[i - 1].startTime + 0.3 : 0
    const prevEdge = Math.max(prevSpanEnd, prevFloor)
    const newStart = Math.max(onset, prevEdge)
    if (newStart >= start) continue
    if (out[i].endTime - newStart < MIN_HIGHLIGHT_S) continue
    // Prevent overlap: if the previous line's displayed end overshoots the new
    // boundary, trim it (mirrors backfillLateStartsToMatchedSpan). Skip the snap
    // if trimming would squash the previous line below MIN_HIGHLIGHT.
    if (i > 0 && out[i - 1].endTime > newStart) {
      if (newStart - out[i - 1].startTime < MIN_HIGHLIGHT_S) continue
      out[i - 1].endTime = newStart
    }
    out[i].startTime = newStart
  }
  return out
}
