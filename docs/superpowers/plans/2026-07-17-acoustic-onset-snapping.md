# Acoustic Onset-Snapping (phase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull a late line start back to the real vocal-energy onset from the phase-1 envelope — the acoustic complement to the existing lexical late-start correctors, for cases they can't handle (garbled transcripts, interpolated segment chunks). Conservative, late-starts-only, `endTime`-preserving.

**Architecture:** Two pure DSP helpers on the existing `VocalActivitySignal` (`nearestOnset`, `hasPreOnsetDip`), plus a new tuner `backfillLateStartsToAcousticOnset` that runs at the end of the `refineAlignmentWithPhrases` tuner chain (only when `options.vocalActivity` is present). Stem-decisive; on a raw mix the acoustic onset must corroborate the line's lexical onset. Signal-absent → byte-identical to today.

**Tech Stack:** TypeScript, Vitest. Builds on branch `acoustic-vocal-activity` (v1); this branch is `acoustic-onset-snapping`.

**Spec:** `docs/superpowers/specs/2026-07-17-acoustic-onset-snapping-design.md`

**Verified integration facts:**
- `src/ai-pipeline/vocalActivity.ts` exports `VocalActivitySignal { hopSec, activity, onset, source }`, `voicedFraction`, `meanActivity`, `VOICED_THRESHOLD`. `onset[f] = max(0, activity[f]-activity[f-1])` (0..1 per-frame rise).
- The tuner chain in `refineAlignmentWithPhrases` (`src/lyrics/phraseAlignment.ts`) ends with a block (~line 1985) that computes `const clean = sanitizeTranscript(words)` and `const spans = computeLineMatchedSpans(tunedLines.map((l) => l.original || l.translation), clean)`, then calls `backfillLineStartsToVocalOnset(tunedLines, clean, spans)` and `backfillLateStartsToMatchedSpan(tunedLines, clean, spans)`. `options` (with `vocalActivity`) is in scope in this function.
- `LineSpans` entries have `firstTime`, `lastEndTime`, `matchedChars`, `totalChars` (used by the existing backfills for the `prevEdge = max(prevSpanEnd, prevFloor)` clamp and coverage).
- `MIN_HIGHLIGHT_S = 1.2` is a module constant.
- `computeLineMatchedSpans` is timing-independent (matched char times from the transcript), so `spans` is stable regardless of line starts.

## File structure

- Modify: `src/ai-pipeline/vocalActivity.ts` — add `nearestOnset` + `hasPreOnsetDip`. Test: `tests/ai-pipeline/vocalActivity.onset.test.ts`.
- Modify: `src/lyrics/phraseAlignment.ts` — add `backfillLateStartsToAcousticOnset` + wire it into the tuner-chain block. Test: `tests/lyrics/onsetSnap.test.ts` (unit, on the exported tuner) + an integration case.

---

## Task 1: DSP helpers — `nearestOnset` + `hasPreOnsetDip`

**Files:**
- Modify: `src/ai-pipeline/vocalActivity.ts`
- Test: `tests/ai-pipeline/vocalActivity.onset.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/ai-pipeline/vocalActivity.onset.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nearestOnset, hasPreOnsetDip, type VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

/** activity 0 on [0,onsetSec), then 1 after; onset = the rise at onsetSec. */
function dipThenVoiced(onsetSec: number, durSec = 20): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  if (oi < frames) onset[oi] = 1 // a single strong rise frame at the onset
  return { hopSec, activity, onset, source: 'stem' }
}

describe('nearestOnset', () => {
  it('finds a strong onset before the target within maxBefore', () => {
    const sig = dipThenVoiced(6)
    const t = nearestOnset(sig, 8, { maxBefore: 3, slackAfter: 0.15, minStrength: 0.3 })
    expect(t).not.toBeNull()
    expect(t!).toBeGreaterThanOrEqual(5.9)
    expect(t!).toBeLessThanOrEqual(6.1)
  })
  it('returns null when no onset clears minStrength in the window', () => {
    const sig = dipThenVoiced(6)
    // target 20 with maxBefore 1 → window [19,20.15] has no onset
    expect(nearestOnset(sig, 20, { maxBefore: 1, slackAfter: 0.15, minStrength: 0.3 })).toBeNull()
  })
})

describe('hasPreOnsetDip', () => {
  it('is true when a silence lull precedes the onset', () => {
    expect(hasPreOnsetDip(dipThenVoiced(6), 6, { dipWindow: 0.5, dipMaxActivity: 0.1 })).toBe(true)
  })
  it('is false when it is loud right before the onset (mid-phrase bump)', () => {
    const hopSec = 0.02, frames = 1000
    const activity = new Float32Array(frames).fill(1) // never silent
    const sig = { hopSec, activity, onset: new Float32Array(frames), source: 'stem' as const }
    expect(hasPreOnsetDip(sig, 6, { dipWindow: 0.5, dipMaxActivity: 0.1 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.onset.test.ts`
Expected: FAIL — `nearestOnset`/`hasPreOnsetDip` not exported.

- [ ] **Step 3: Add the helpers to `src/ai-pipeline/vocalActivity.ts`** (append after `meanActivity`):

```ts
/**
 * Time of the strongest `onset` peak in [targetSec - maxBefore, targetSec + slackAfter]
 * whose strength ≥ minStrength, or null. A late line start sits AFTER its real
 * vocal onset, so the search reaches back before the target.
 */
export function nearestOnset(
  sig: VocalActivitySignal,
  targetSec: number,
  opts: { maxBefore: number; slackAfter: number; minStrength: number },
): number | null {
  if (sig.onset.length === 0) return null
  const a = Math.max(0, Math.floor((targetSec - opts.maxBefore) / sig.hopSec))
  const b = Math.min(sig.onset.length, Math.ceil((targetSec + opts.slackAfter) / sig.hopSec))
  let bestF = -1
  let best = opts.minStrength
  for (let f = a; f < b; f++) {
    if (sig.onset[f] >= best) { best = sig.onset[f]; bestF = f }
  }
  return bestF < 0 ? null : bestF * sig.hopSec
}

/** True when a genuine low-activity lull precedes onsetSec (a real phrase onset
 * emerging from silence, not a mid-word bump): mean activity in
 * [onsetSec - dipWindow, onsetSec) is below dipMaxActivity. */
export function hasPreOnsetDip(
  sig: VocalActivitySignal,
  onsetSec: number,
  opts: { dipWindow: number; dipMaxActivity: number },
): boolean {
  if (onsetSec - opts.dipWindow < 0) return false
  return meanActivity(sig, onsetSec - opts.dipWindow, onsetSec) < opts.dipMaxActivity
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.onset.test.ts`
Expected: PASS (4/4). (Note: `nearestOnset`'s `>=` tie-break returns the LATEST max-strength frame; with a single onset frame that's exact. Do not weaken the ±0.1 s bounds.)

- [ ] **Step 5: `npx tsc --noEmit` + commit**

```bash
git add src/ai-pipeline/vocalActivity.ts tests/ai-pipeline/vocalActivity.onset.test.ts
git commit --no-gpg-sign -m "feat(align): nearestOnset + hasPreOnsetDip helpers for onset-snapping"
```

---

## Task 2: the `backfillLateStartsToAcousticOnset` tuner

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts`
- Test: `tests/lyrics/onsetSnap.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/lyrics/onsetSnap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { backfillLateStartsToAcousticOnset } from '../../src/lyrics/phraseAlignment'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TimedLine } from '../../src/core/types'

// NOTE: TranscriptWord's field is `word`, not `text`.
const w = (word: string, s: number, e: number): TranscriptWord => ({ word, startTime: s, endTime: e } as TranscriptWord)

/** activity 0 on [0,onsetSec), 1 after; a strong onset frame at onsetSec. */
function dipOnsetVoiced(onsetSec: number, source: 'stem' | 'mix' = 'stem', durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  onset[oi] = 1
  return { hopSec, activity, onset, source }
}

describe('backfillLateStartsToAcousticOnset', () => {
  // One line, sung 'ここで歌う' with transcript onset at 6s; the line's start was
  // placed LATE at 8s. spans give coverage 1.0 and firstTime ≈ 6.
  const mk = (startTime: number): TimedLine[] => [{ original: 'ここで歌う', translation: '', startTime, endTime: startTime + 4 }]
  const words = [w('ここで', 6, 8), w('歌う', 8, 10)]
  const spans = (lines: TimedLine[]) => computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(words))

  it('snaps a late start back to the vocal onset (stem), endTime preserved', () => {
    const lines = mk(8)
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), dipOnsetVoiced(6, 'stem'))
    expect(out[0].startTime).toBeGreaterThanOrEqual(5.9)
    expect(out[0].startTime).toBeLessThanOrEqual(6.1)
    expect(out[0].endTime).toBe(12) // unchanged
  })

  it('does NOT snap when there is no pre-onset dip (mid-phrase, activity all voiced)', () => {
    const lines = mk(8)
    const hopSec = 0.02, frames = 30 / hopSec
    const loud = { hopSec, activity: new Float32Array(frames).fill(1), onset: (() => { const o = new Float32Array(frames); o[Math.floor(6 / hopSec)] = 1; return o })(), source: 'stem' as const }
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), loud)
    expect(out[0].startTime).toBe(8) // unchanged: no dip → not a phrase onset
  })

  // A disagreeing onset INSIDE the search window: a transient at 7s while the
  // transcript onset (span.firstTime) is ~6s — exercises the mix corroboration
  // (not a window-miss). dip before 7, voiced after, so all OTHER gates pass.
  function dipOnset7(source: 'stem' | 'mix'): VocalActivitySignal {
    const hopSec = 0.02, frames = Math.ceil(30 / hopSec)
    const activity = new Float32Array(frames), onset = new Float32Array(frames)
    const oi = Math.floor(7 / hopSec)
    for (let f = oi; f < frames; f++) activity[f] = 1
    onset[oi] = 1
    return { hopSec, activity, onset, source }
  }

  it('does NOT snap on a raw mix when the acoustic onset disagrees with the lexical onset', () => {
    const lines = mk(8)
    // acoustic onset 7 vs lexical span.firstTime ~6 → |1s| > 0.5 tol → spared on mix.
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), dipOnset7('mix'))
    expect(out[0].startTime).toBe(8)
  })

  it('snaps on a stem even when the acoustic onset disagrees with the lexical onset (stem decisive)', () => {
    const lines = mk(8)
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), dipOnset7('stem'))
    expect(out[0].startTime).toBeGreaterThanOrEqual(6.9)
    expect(out[0].startTime).toBeLessThanOrEqual(7.1)
  })

  it('DOES snap on a raw mix when the acoustic onset agrees with the lexical onset', () => {
    const lines = mk(8)
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), dipOnsetVoiced(6, 'mix'))
    expect(out[0].startTime).toBeLessThanOrEqual(6.1)
  })

  it('does NOT snap a poorly-anchored line (coverage below floor)', () => {
    // Transcript matches nothing in the line → coverage 0.
    const lines = mk(8)
    const noMatch = [w('まったく', 6, 8), w('ちがう', 8, 10)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(noMatch), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(noMatch)), dipOnsetVoiced(6, 'stem'))
    expect(out[0].startTime).toBe(8)
  })

  it('never moves a start across the previous line', () => {
    const lines: TimedLine[] = [
      { original: 'まえのぎょう', translation: '', startTime: 5.5, endTime: 8 }, // prev line ends at 8
      { original: 'ここで歌う', translation: '', startTime: 8, endTime: 12 },
    ]
    const two = [w('まえの', 5.5, 7), w('ぎょう', 7, 8), w('ここで', 6, 8), w('歌う', 8, 10)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(two), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(two)), dipOnsetVoiced(6, 'stem'))
    // onset at 6 is before the previous line's end (8) → clamped; the snapped start
    // must not precede prevEdge, so it stays >= the previous line's edge and cannot land at 6.
    expect(out[1].startTime).toBeGreaterThanOrEqual(out[0].startTime + 0.3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lyrics/onsetSnap.test.ts`
Expected: FAIL — `backfillLateStartsToAcousticOnset` not exported.

- [ ] **Step 3: Add the tuner + constants to `src/lyrics/phraseAlignment.ts`.**

Add the import (with the other `../ai-pipeline/vocalActivity` usage — it may not be imported yet):
```ts
import { nearestOnset, hasPreOnsetDip, voicedFraction, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'
```
Add constants near the other `LATESTART_*` constants:
```ts
const ACOUSTIC_MAX_PULL_S = 2.0
const ACOUSTIC_MIN_PULL_S = 0.3
const ACOUSTIC_SLACK_S = 0.15
const ACOUSTIC_ONSET_MIN_STRENGTH = 0.15
const ACOUSTIC_DIP_WINDOW_S = 0.5
const ACOUSTIC_DIP_MAX_ACTIVITY = 0.1
const ACOUSTIC_VOICED_RUN_MIN = 0.6
const ACOUSTIC_SNAP_MIN_COVERAGE = 0.3
const ACOUSTIC_MIX_CORROBORATE_TOL_S = 0.5
```
Add the tuner (near `backfillLateStartsToMatchedSpan`):
```ts
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
  clean: TranscriptWord[],
  spans: LineSpans,
  sig: VocalActivitySignal,
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const span = spans[i]
    if (!span) continue
    const coverage = span.matchedChars / Math.max(1, span.totalChars)
    if (coverage < ACOUSTIC_SNAP_MIN_COVERAGE) continue // refine, don't fabricate

    const start = out[i].startTime
    const onset = nearestOnset(sig, start, {
      maxBefore: ACOUSTIC_MAX_PULL_S,
      slackAfter: ACOUSTIC_SLACK_S,
      minStrength: ACOUSTIC_ONSET_MIN_STRENGTH,
    })
    if (onset == null || start - onset < ACOUSTIC_MIN_PULL_S) continue // not meaningfully late
    if (!hasPreOnsetDip(sig, onset, { dipWindow: ACOUSTIC_DIP_WINDOW_S, dipMaxActivity: ACOUSTIC_DIP_MAX_ACTIVITY })) continue // real phrase onset
    if (voicedFraction(sig, onset, start) < ACOUSTIC_VOICED_RUN_MIN) continue // vocals sustained to the late start

    if (sig.source === 'mix' && Math.abs(span.firstTime - onset) > ACOUSTIC_MIX_CORROBORATE_TOL_S) continue // mix: require lexical agreement

    // Ownership clamp (mirrors the lexical backfills): never before the previous
    // line's own matched content / display floor.
    const prevSpanEnd = i > 0 ? spans[i - 1]?.lastEndTime ?? -Infinity : -Infinity
    const prevFloor = i > 0 ? out[i - 1].startTime + 0.3 : 0
    const prevEdge = Math.max(prevSpanEnd, prevFloor)
    const newStart = Math.max(onset, prevEdge)
    if (newStart >= start) continue // only ever move earlier
    if (out[i].endTime - newStart < MIN_HIGHLIGHT_S) continue // keep the line visible; endTime untouched
    out[i].startTime = newStart
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lyrics/onsetSnap.test.ts`
Expected: PASS (6/6). If the "never crosses the previous line" test is off, check `prevEdge` — with the prev line ending at 8 and onset at 6, `prevSpanEnd` (its matched span's lastEndTime ≈ 8) clamps `newStart` to ≈8 ≥ start(8) → no move, which satisfies the assertion.

- [ ] **Step 5: `npx tsc --noEmit` clean; commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/lyrics/onsetSnap.test.ts
git commit --no-gpg-sign -m "feat(align): backfillLateStartsToAcousticOnset tuner (stem-decisive, mix-corroborated)"
```

---

## Task 3: Wire the tuner into the chain + integration test

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts` (the tuner-chain block)
- Test: `tests/lyrics/onsetSnap.test.ts` (add an integration case)

- [ ] **Step 1: Write the failing integration test** — append to `tests/lyrics/onsetSnap.test.ts`:

```ts
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

describe('refineAlignmentWithPhrases threads vocalActivity to acoustic onset-snapping', () => {
  // A sheet + transcript whose lexical alignment leaves line 2's start a bit late,
  // with a clean acoustic onset before it. With the signal, the start moves earlier;
  // without it, unchanged. (Uses the same absolute-time envelope.)
  const sheet: TimedLine[] = [
    { original: 'いちぎょうめ', translation: '', startTime: 0, endTime: 0 },
    { original: 'にぎょうめここで', translation: '', startTime: 0, endTime: 0 },
  ]
  const tw = (word: string, s: number, e: number): TranscriptWord => ({ word, startTime: s, endTime: e } as TranscriptWord)
  const words = [tw('いちぎょうめ', 1, 4), tw('にぎょうめここで', 9, 13)]
  // envelope: dip then a strong onset at ~8.5 (before the line-2 transcript onset 9),
  // voiced through. Absolute song time.
  function sig(): VocalActivitySignal {
    const hopSec = 0.02, frames = Math.ceil(20 / hopSec)
    const activity = new Float32Array(frames), onset = new Float32Array(frames)
    for (let f = Math.floor(8.5 / hopSec); f < frames; f++) activity[f] = 1
    onset[Math.floor(8.5 / hopSec)] = 1
    return { hopSec, activity, onset, source: 'stem' }
  }

  it('moves a late start earlier only when the signal is present', () => {
    const base = refineAlignmentWithPhrases(sheet, words, 'ja')
    const withSig = refineAlignmentWithPhrases(sheet, words, 'ja', undefined, { vocalActivity: sig() })
    // Same shape; line 2's start is <= the base start with the signal (never later).
    expect(withSig.lines.length).toBe(base.lines.length)
    expect(withSig.lines[1].startTime).toBeLessThanOrEqual(base.lines[1].startTime)
  })
})
```
(If `base.lines[1].startTime` already sits at/near the onset — the lexical backfills may have handled it — this asserts `<=` which still holds; the point is the acoustic tuner never pushes it later and fires when lexical didn't. If you cannot construct a case where the signal strictly moves it, keep the `<=` assertion and add a direct-tuner assertion instead, since Task 2 already proves the snapping behavior.)

- [ ] **Step 2: Run to verify it fails or is inert**

Run: `npx vitest run tests/lyrics/onsetSnap.test.ts -t "threads vocalActivity"`
Expected: with the tuner unwired, `withSig` == `base` (the `<=` passes trivially). This test mainly guards the WIRING + no-push-later invariant; the snapping proof is Task 2's unit tests. Proceed to wire it.

- [ ] **Step 3: Wire the tuner into the tuner-chain block** in `refineAlignmentWithPhrases` (`src/lyrics/phraseAlignment.ts`, the `{ const clean = …; const spans = …; backfillLineStartsToVocalOnset(…); backfillLateStartsToMatchedSpan(…) }` block, ~line 1985). Add the acoustic tuner AFTER both lexical ones, gated on the signal:

```ts
  {
    const clean = sanitizeTranscript(words)
    const spans = computeLineMatchedSpans(
      tunedLines.map((l) => l.original || l.translation),
      clean,
    )
    tunedLines = backfillLineStartsToVocalOnset(tunedLines, clean, spans)
    tunedLines = backfillLateStartsToMatchedSpan(tunedLines, clean, spans)
    if (options?.vocalActivity) {
      tunedLines = backfillLateStartsToAcousticOnset(tunedLines, clean, spans, options.vocalActivity)
    }
  }
```

- [ ] **Step 4: Run the integration test + full suite:**

Run: `npx vitest run tests/lyrics/onsetSnap.test.ts` (all pass), then `npx vitest run`, then `npx tsc --noEmit`.
Expected: green. Signal-absent callers (all existing) are unchanged — the tuner is gated on `options?.vocalActivity`.

- [ ] **Step 5: Corpus baseline unchanged (both signal-absent AND binary-onset-fixture invariants):**

Run: `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: `✓ No regressions vs baseline.` The corpus signal-absent pass is unchanged; and the acoustic pass (akfg-instrumental-word) uses a fixture whose `onset` track is all zeros, so `nearestOnset` returns null → onset-snapping never fires → the acoustic pass's timings/`acoustic_demoted` are unchanged too. (If `acoustic_demoted` changed, STOP — the onset fixture is not all-zero, or the tuner fired unexpectedly.)

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/lyrics/onsetSnap.test.ts
git commit --no-gpg-sign -m "feat(align): wire acoustic onset-snapping into the tuner chain (fresh-align)"
```

---

## Final verification

- [ ] Full suite: `npx vitest run` → green.
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Corpus: `npx tsx scripts/audit-corpus.mjs --check-baseline` → `✓ No regressions vs baseline.`
- [ ] Live (fresh Auto-align, "Isolate vocals" ON): a song where a line's highlight used to light up a beat late — confirm it now lands on the vocal onset, and that clean lines / the first line are unaffected. Report console + a before/after timing.
- [ ] Honest note in the PR: real-world timing improvement is proven only by the user's derived envelopes + `e2e-align.mjs`; the committed corpus can't exercise onset-snapping (synthetic all-zero onset track).

## Self-review notes (author)

- **Spec coverage:** helpers (T1); tuner with all 5 gates incl. stem-decisive/mix-corroborated (T2); wiring + integration + corpus-safe (T3). Safety invariants (signal-absent byte-identical; earlier-only; endTime preserved; never cross previous line; MIN_HIGHLIGHT) enforced in the tuner and verified in T2/T3.
- **Naming:** `backfillLateStartsToAcousticOnset` is distinct from the existing lexical `backfillLineStartsToVocalOnset`; runs after both lexical correctors so it only touches the residue.
- **TranscriptWord field is `word` not `text`** — used correctly in all test helpers.
- **Deferred (spec):** repeated-chorus onset disambiguation; early-start correction; a percussion-robust decisive mix path; a real-onset corpus fixture (needs user envelopes).
