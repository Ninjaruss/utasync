import type { AlignmentLanguage, TimedLine } from '../core/types'
import { lineWeight } from '../ai-pipeline/aligner'
import { enforceLineMonotonicity } from './phraseAlignment'
import { nearestOnset, hasPreOnsetDip, voicedFraction, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'
import { computeLineMatchedSpans } from '../ai-pipeline/contentAligner'

const MIN_HIGHLIGHT_S = 1.2

/** When the aligner has crammed the opening lines onto an instrumental intro
 * (first sung line starts well BEFORE the detected vocal onset), pin the opening
 * to `onsetTime` and re-spread the crammed leading lines forward, by singing
 * weight, up to the first line already placed at/after the onset. Start-only;
 * conservative — no-op unless the first line is at least MIN_GAP before the onset
 * AND there is a later line to bound the re-spread. Returns a new lines array. */
export function anchorLeadingEdge(
  lines: TimedLine[],
  onsetTime: number,
  sourceLanguage: AlignmentLanguage,
  opts?: { minGapSec?: number },
): TimedLine[] {
  const MIN_GAP = opts?.minGapSec ?? 3.0
  const lineText = (l: TimedLine) => (l.original || l.translation).trim()

  const firstIdx = lines.findIndex((l) => lineText(l).length > 0)
  if (firstIdx === -1) return lines

  // Not crammed before the onset — leave it alone.
  if (onsetTime - lines[firstIdx].startTime < MIN_GAP) return lines

  // Find the first line already placed at/after the onset to bound the re-spread.
  let boundIdx = -1
  for (let j = firstIdx + 1; j < lines.length; j++) {
    if (lines[j].startTime >= onsetTime) {
      boundIdx = j
      break
    }
  }
  if (boundIdx === -1) return lines // degenerate: whole song before onset

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
