# Acoustic Vocal-Activity Signal (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed a vocal-activity envelope (derived from the audio already decoded at align time — the Demucs vocal stem when separation is on, else the mix) into the aligner so it demotes confident line labels that sit on non-vocal audio (intros, instrumental breaks, Whisper break-hallucinations). This is v1: the false-positive killers. Onset-snapping is phase 2 (separate plan).

**Architecture:** A new pure-DSP module computes `{ hopSec, activity, onset, source }` from mono PCM using the existing STFT. It threads through `AlignLyricsOptions` into `applyLabelHonesty`, where a new **acoustic gate** demotes `good → approximate` for any line whose time window is acoustically empty of vocals — *corroborating* (never overriding a strong lexical match on a raw mix). When the signal is absent (stored re-refine, compute failure), every code path is byte-identical to today.

**Tech Stack:** TypeScript, Vitest, existing `src/ai-pipeline/fft.ts` (STFT), `scripts/lib/nodeAudio.mjs` (`decodeMp3ToMono`), the `audit-corpus.mjs` scorecard.

**Spec:** `docs/superpowers/specs/2026-07-17-acoustic-vocal-activity-aligner-design.md`

**Verified integration facts:**
- `fft.ts` exports `hannWindow(size)` and `stft(audio, nFft, hop, win): { real: Float32Array[][bin][frame], imag, frames }` (one-sided, `nBins = nFft/2+1`).
- `AlignLyricsOptions` is defined at `src/ai-pipeline/aligner.ts:362`; `alignLyrics`/`refineAlignmentWithPhrases` thread it.
- `applyLabelHonesty(input: LabelHonestyInput): LineAlignmentQuality[]` (`src/lyrics/labelHonesty.ts:96`) is label-only, downward (`good→approximate`), and has per-line `spans` + a `coverage(i)` helper. Called at TWO sites: single-pass `src/lyrics/phraseAlignment.ts:2099` (inside `refineAlignmentWithPhrases`, `options` in scope) and merged `src/ai-pipeline/mixedLanguageAlign.ts:242` (inside `refineMixedLanguageAlignment(sheetRows, jaWords, enWords)` — no options param yet).
- `AutoAlignFlow.tsx`: `audioData`/`sampleRate` are the Demucs vocal stem when `willSeparate` (line ~201/219). Align sites: single-language `refineAlignmentWithPhrases(sheetRows, words, alignmentLanguage, song.lyrics)` at line ~379; mixed `refineMixedLanguageAlignment(sheetRows, ja, en)` at line ~365.
- `LineAlignmentQuality = 'good' | 'approximate' | 'needs_review'` (`src/core/types/index.ts:82`).
- `audit-corpus.mjs`: per-song loop at line ~146; align at ~160; scorecard assembled at ~228; `--write-baseline`/`--check-baseline` vs `fixtures/corpus-baseline.json`.

## File structure

- Create: `src/ai-pipeline/vocalActivity.ts` — DSP + query helpers. Test: `tests/ai-pipeline/vocalActivity.test.ts`.
- Modify: `src/ai-pipeline/aligner.ts` — `AlignLyricsOptions.vocalActivity?`.
- Modify: `src/lyrics/labelHonesty.ts` — `LabelHonestyInput.vocalActivity?` + the acoustic gate. Test: `tests/lyrics/labelHonesty.acoustic.test.ts`.
- Modify: `src/lyrics/phraseAlignment.ts` — pass `vocalActivity` into the single-pass `applyLabelHonesty`.
- Modify: `src/ai-pipeline/mixedLanguageAlign.ts` — `refineMixedLanguageAlignment` gains a `vocalActivity` param, threaded to the merged `applyLabelHonesty`.
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx` — compute the envelope post-Demucs; inject at both align sites.
- Create: `scripts/make-vocal-activity.mjs` — derive a committed envelope fixture from a local MP3.
- Create: `tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json` — a synthetic committed envelope (voiced except the known break) for the deterministic audit guard.
- Modify: `scripts/audit-corpus.mjs` — acoustic pass + metrics when an envelope fixture exists. Test/guard via the existing scorecard ratchet.

---

## Task 1: `vocalActivity.ts` — DSP module + query helper

**Files:**
- Create: `src/ai-pipeline/vocalActivity.ts`
- Test: `tests/ai-pipeline/vocalActivity.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/ai-pipeline/vocalActivity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeVocalActivity, voicedFraction } from '../../src/ai-pipeline/vocalActivity'

const SR = 16000

/** Fill [startSec,endSec) of `pcm` with a sine at `freqHz`. */
function tone(pcm: Float32Array, sr: number, startSec: number, endSec: number, freqHz: number, amp = 0.5) {
  const a = Math.floor(startSec * sr), b = Math.min(pcm.length, Math.floor(endSec * sr))
  for (let i = a; i < b; i++) pcm[i] += amp * Math.sin((2 * Math.PI * freqHz * i) / sr)
}

describe('computeVocalActivity', () => {
  it('reports high activity in a vocal-band region and low activity in silence', () => {
    const pcm = new Float32Array(SR * 6) // 6s, all silent...
    tone(pcm, SR, 1, 3, 300)  // ...except a 300Hz (vocal-band) tone 1–3s
    const sig = computeVocalActivity(pcm, SR, { source: 'stem' })
    expect(sig.source).toBe('stem')
    expect(sig.hopSec).toBeGreaterThan(0)
    expect(voicedFraction(sig, 1.2, 2.8)).toBeGreaterThan(0.8) // tone region is voiced
    expect(voicedFraction(sig, 3.5, 5.5)).toBeLessThan(0.2)    // silent region is not
  })

  it('treats out-of-band (sub-bass) energy as non-vocal', () => {
    const pcm = new Float32Array(SR * 4)
    tone(pcm, SR, 0.5, 3.5, 60) // 60Hz bass, below the vocal band
    const sig = computeVocalActivity(pcm, SR, { source: 'mix' })
    expect(voicedFraction(sig, 1, 3)).toBeLessThan(0.3)
  })

  it('is empty-safe (zero-length input)', () => {
    const sig = computeVocalActivity(new Float32Array(0), SR, { source: 'mix' })
    expect(sig.activity.length).toBe(0)
    expect(voicedFraction(sig, 0, 1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/ai-pipeline/vocalActivity.ts`**

```ts
/**
 * Vocal-activity envelope: an audio-derived, per-frame "is a voice present?"
 * curve the aligner uses to demote confident lyric labels that sit on non-vocal
 * audio (intros, instrumental breaks, Whisper break-hallucinations). Pure DSP,
 * deterministic (no RNG) so it can back committed fixtures. See
 * docs/superpowers/specs/2026-07-17-acoustic-vocal-activity-aligner-design.md.
 */
import { hannWindow, stft } from './fft'

export interface VocalActivitySignal {
  /** Frame period in seconds (hop / sampleRate). */
  hopSec: number
  /** Per-frame vocal-band energy, robust-normalized to 0..1. */
  activity: Float32Array
  /** Per-frame onset strength (half-wave-rectified spectral flux), 0..1. Phase 2. */
  onset: Float32Array
  /** Provenance: 'stem' (Demucs vocal isolate — trustworthy) or 'mix' (weaker prior). */
  source: 'stem' | 'mix'
}

const VOCAL_LO_HZ = 150
const VOCAL_HI_HZ = 4000
/** A frame counts as voiced when its normalized activity exceeds this. */
export const VOICED_THRESHOLD = 0.15

/** Nearest power of two ≥ n. */
function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p }

/** p-th percentile of the positive values of `arr` (p in 0..1); 0 when all-zero. */
function percentile(arr: Float32Array, p: number): number {
  const pos = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b)
  if (pos.length === 0) return 0
  return pos[Math.min(pos.length - 1, Math.floor(p * (pos.length - 1)))]
}

export function computeVocalActivity(
  pcm: Float32Array,
  sampleRate: number,
  opts: { source: 'stem' | 'mix' },
): VocalActivitySignal {
  // window ≈46ms; hop = nFft/2 (≈23ms at 44.1kHz, ≈32ms at 16kHz).
  const nFft = Math.max(256, nextPow2(Math.round(0.046 * sampleRate)))
  const hop = Math.max(1, Math.round(nFft / 2))
  const hopSec = hop / sampleRate
  if (pcm.length < nFft) {
    return { hopSec, activity: new Float32Array(0), onset: new Float32Array(0), source: opts.source }
  }
  const { real, imag, frames } = stft(pcm, nFft, hop, hannWindow(nFft))
  const binLo = Math.max(1, Math.floor((VOCAL_LO_HZ * nFft) / sampleRate))
  const binHi = Math.min(real.length - 1, Math.ceil((VOCAL_HI_HZ * nFft) / sampleRate))

  // Per-frame vocal-band and total power.
  const vocalPow = new Float32Array(frames)
  const totalPow = new Float32Array(frames)
  const totalMag = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let vp = 0, tp = 0
    for (let b = 0; b < real.length; b++) {
      const p = real[b][f] * real[b][f] + imag[b][f] * imag[b][f]
      tp += p
      if (b >= binLo && b <= binHi) vp += p
    }
    vocalPow[f] = vp
    totalPow[f] = tp
    totalMag[f] = Math.sqrt(tp)
  }

  // activity = vocal-band concentration × loudness.
  //  - concentration (vocalPow/totalPow, 0..1) distinguishes vocal-band-dominant
  //    energy from bass/percussion — amplitude-invariant.
  //  - loudness (totalMag vs a high percentile) is an ABSOLUTE-energy anchor so
  //    faint out-of-band leakage in near-silence can't read as "fully voiced"
  //    (which a bare percentile-of-positives normalization does).
  const loudNorm = percentile(totalMag, 0.95) || 1e-9
  const EPS = 1e-9
  const activity = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const concentration = vocalPow[f] / (totalPow[f] + EPS)
    const loudness = Math.min(1, totalMag[f] / loudNorm)
    activity[f] = concentration * loudness
  }
  // Onset strength (phase 2): half-wave rise in activity.
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, activity[f] - activity[f - 1])

  return { hopSec, activity, onset, source: opts.source }
}

/** Fraction of frames in [startSec, endSec) whose activity ≥ VOICED_THRESHOLD. */
export function voicedFraction(sig: VocalActivitySignal, startSec: number, endSec: number): number {
  if (sig.activity.length === 0 || endSec <= startSec) return 0
  const a = Math.max(0, Math.floor(startSec / sig.hopSec))
  const b = Math.min(sig.activity.length, Math.ceil(endSec / sig.hopSec))
  if (b <= a) return 0
  let voiced = 0
  for (let f = a; f < b; f++) if (sig.activity[f] >= VOICED_THRESHOLD) voiced++
  return voiced / (b - a)
}

/** Mean activity over [startSec, endSec). */
export function meanActivity(sig: VocalActivitySignal, startSec: number, endSec: number): number {
  if (sig.activity.length === 0 || endSec <= startSec) return 0
  const a = Math.max(0, Math.floor(startSec / sig.hopSec))
  const b = Math.min(sig.activity.length, Math.ceil(endSec / sig.hopSec))
  if (b <= a) return 0
  let sum = 0
  for (let f = a; f < b; f++) sum += sig.activity[f]
  return sum / (b - a)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.test.ts`
Expected: PASS (3/3). If the tone-region threshold is borderline, the DSP is still correct — do NOT weaken the test to below 0.8/0.2; instead confirm `VOICED_THRESHOLD`/percentile behave (a pure 300Hz tone at amp 0.5 dominates a silent song, so p95-normalized activity in the tone region ≈ 1).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/ai-pipeline/vocalActivity.ts tests/ai-pipeline/vocalActivity.test.ts
git commit --no-gpg-sign -m "feat(align): vocal-activity envelope DSP (STFT vocal-band energy)"
```

---

## Task 2: Thread `vocalActivity` through the option/param types (no behavior change)

**Files:**
- Modify: `src/ai-pipeline/aligner.ts` (`AlignLyricsOptions`)
- Modify: `src/lyrics/labelHonesty.ts` (`LabelHonestyInput`)
- Modify: `src/ai-pipeline/mixedLanguageAlign.ts` (`refineMixedLanguageAlignment` param)

This task only widens types + plumbs an optional field; no gate logic yet. The full suite must stay green (every existing call omits the field → behavior identical).

- [ ] **Step 1: Add the field to `AlignLyricsOptions`** (`src/ai-pipeline/aligner.ts`, inside the interface at line ~362, after `skipLabelHonesty`):

```ts
  /** Audio-derived vocal-activity envelope (fresh-align only). When present,
   * applyLabelHonesty demotes confident lines that sit on non-vocal audio.
   * Absent → text-only behavior, byte-identical to before. */
  vocalActivity?: import('./vocalActivity').VocalActivitySignal
```

- [ ] **Step 2: Add the field to `LabelHonestyInput`** (`src/lyrics/labelHonesty.ts`, after `spans?`):

```ts
  /** Audio-derived vocal-activity envelope (fresh-align only); enables the
   * acoustic gate. Absent → no acoustic demotion. */
  vocalActivity?: import('../ai-pipeline/vocalActivity').VocalActivitySignal
```

- [ ] **Step 3: Add a param to `refineMixedLanguageAlignment`** (`src/ai-pipeline/mixedLanguageAlign.ts:208`). Change the signature and thread it ONLY to the merged honesty call:

```ts
export function refineMixedLanguageAlignment(
  sheetRows: TimedLine[],
  jaWords: TranscriptWord[],
  enWords: TranscriptWord[],
  vocalActivity?: import('./vocalActivity').VocalActivitySignal,
): MixedAlignmentResult {
```
(The inner passes still `skipLabelHonesty`; do not pass `vocalActivity` to them. It is consumed only at the merged `applyLabelHonesty` call, wired in Task 4.)

- [ ] **Step 4: Typecheck + full suite (no behavior change)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; all tests pass (the new fields are optional and unused so far).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/aligner.ts src/lyrics/labelHonesty.ts src/ai-pipeline/mixedLanguageAlign.ts
git commit --no-gpg-sign -m "feat(align): plumb optional vocalActivity through align option/param types"
```

---

## Task 3: The acoustic gate in `applyLabelHonesty`

**Files:**
- Modify: `src/lyrics/labelHonesty.ts`
- Test: `tests/lyrics/labelHonesty.acoustic.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/lyrics/labelHonesty.acoustic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyLabelHonesty } from '../../src/lyrics/labelHonesty'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/** Envelope with `activity`=1 everywhere except [breakStart,breakEnd)=0. */
function signal(source: 'stem' | 'mix', breakStart: number, breakEnd: number, durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames).fill(1)
  for (let f = Math.floor(breakStart / hopSec); f < Math.ceil(breakEnd / hopSec) && f < frames; f++) activity[f] = 0
  return { hopSec, activity, onset: new Float32Array(frames), source }
}

const line = (original: string, startTime: number, endTime: number): TimedLine => ({ original, translation: '', startTime, endTime })
// NOTE: TranscriptWord's field is `word`, not `text`.
const word = (text: string, s: number, e: number): TranscriptWord => ({ word: text, startTime: s, endTime: e } as TranscriptWord)

describe('applyLabelHonesty acoustic gate', () => {
  const lines = [line('歌ってる', 1, 4), line('ここは無音', 10, 14), line('また歌う', 20, 23)]
  const lineTexts = lines.map((l) => l.original)
  // Transcript matches lines 0 and 2; line 1 sits on the acoustic break (10–15s).
  const words = [word('歌っ', 1, 2), word('てる', 2, 4), word('また', 20, 21), word('歌う', 21, 23)]

  it('demotes a good line whose window is acoustically empty (stem)', () => {
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content',
      vocalActivity: signal('stem', 10, 15),
    })
    expect(q[1]).toBe('approximate') // on the break → demoted
    expect(q[0]).toBe('good')        // real vocals → kept
    expect(q[2]).toBe('good')
  })

  it('does NOT demote on a raw mix when the line has strong lexical coverage', () => {
    // Line 1 now has matching transcript words inside the "break" window.
    const wordsCovered = [...words, word('ここは', 10.5, 11.5), word('無音', 11.5, 13)]
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words: wordsCovered, mode: 'content',
      vocalActivity: signal('mix', 10, 15),
    })
    expect(q[1]).toBe('good') // mix + strong lexical coverage → spared (corroborate, don't override)
  })

  it('DOES demote on a stem even with lexical coverage (stem is decisive)', () => {
    const wordsCovered = [...words, word('ここは', 10.5, 11.5), word('無音', 11.5, 13)]
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words: wordsCovered, mode: 'content',
      vocalActivity: signal('stem', 10, 15),
    })
    expect(q[1]).toBe('approximate')
  })

  it('is a no-op when no vocalActivity is supplied', () => {
    const q = applyLabelHonesty({ lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content' })
    expect(q).toEqual(['good', 'good', 'good'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lyrics/labelHonesty.acoustic.test.ts`
Expected: FAIL — the acoustic gate does not exist (line 1 stays 'good').

- [ ] **Step 3: Add the gate.** In `src/lyrics/labelHonesty.ts`:

(a) Add the import at the top:
```ts
import { voicedFraction } from '../ai-pipeline/vocalActivity'
```
(b) Add these constants near the other module constants (after `DESERT_MIN_NEIGHBORS`):
```ts
/** A 'good' line whose window is voiced below this fraction is acoustically
 * unsupported (intro / instrumental break / Whisper hallucination). */
const STEM_MIN_VOICED_FRAC = 0.2
/** On a raw-mix signal the prior is weaker: require a lower bar AND spare lines
 * with strong lexical coverage (quiet vocals under loud instruments). */
const MIX_MIN_VOICED_FRAC = 0.1
```
(c) Add Gate 5 immediately before `return quality` at the end of `applyLabelHonesty`:
```ts
  // Gate 5 — acoustic vocal-activity. When an audio-derived envelope is present,
  // demote a 'good' line whose window carries almost no vocal energy (placed on
  // an intro / instrumental break / Whisper break-hallucination). This is an
  // INDEPENDENT signal from the lexical gates above. Corroborate-don't-override:
  // on a raw-mix envelope, spare a line with strong lexical coverage (quiet
  // vocals under loud instruments read as low band energy); a Demucs-stem
  // envelope is decisive.
  const va = input.vocalActivity
  if (va) {
    const strict = va.source === 'stem'
    const minVoiced = strict ? STEM_MIN_VOICED_FRAC : MIX_MIN_VOICED_FRAC
    for (let i = 0; i < lines.length; i++) {
      if (quality[i] !== 'good') continue
      if (voicedFraction(va, lines[i].startTime, lines[i].endTime) >= minVoiced) continue
      if (!strict && coverage(i) >= SPAN_MIN_COVERAGE) continue
      demote(i)
    }
  }
```
(Note: `coverage` and `spans` are already computed above Gate 2; Gate 5 sits after them, so both are in scope. Gate 5 must run for `mode === 'content'` — it is after the early `proportional` return, which already demotes everything, so no separate proportional handling is needed.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lyrics/labelHonesty.acoustic.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Full label-honesty suite + tsc (no regression to existing gates)**

Run: `npx vitest run tests/ai-pipeline/labelHonesty.corpus.test.ts tests/lyrics/labelHonesty.acoustic.test.ts && npx tsc --noEmit`
Expected: PASS — existing label-honesty ratchet unaffected (those runs pass no `vocalActivity`).

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/labelHonesty.ts tests/lyrics/labelHonesty.acoustic.test.ts
git commit --no-gpg-sign -m "feat(align): acoustic gate in applyLabelHonesty (demote non-vocal placements)"
```

---

## Task 4: Wire `vocalActivity` into both `applyLabelHonesty` call sites

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts` (single-pass call, line ~2099)
- Modify: `src/ai-pipeline/mixedLanguageAlign.ts` (merged call, line ~242)
- Test: `tests/ai-pipeline/vocalActivity.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** — `tests/ai-pipeline/vocalActivity.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

/** All-silent stem envelope: EVERY line's window is acoustically empty, so every
 * 'good' line must demote — a deterministic, non-vacuous proof that the signal
 * reached applyLabelHonesty. (durSec generous so it covers all placed windows.) */
function allSilent(durSec = 120): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  return { hopSec, activity: new Float32Array(frames), onset: new Float32Array(frames), source: 'stem' }
}

// NOTE: TranscriptWord's field is `word`, not `text`.
const w = (text: string, s: number, e: number): TranscriptWord => ({ word: text, startTime: s, endTime: e } as TranscriptWord)

describe('refineAlignmentWithPhrases threads vocalActivity to label honesty', () => {
  const sheet: TimedLine[] = [
    { original: 'あいうえお', translation: '', startTime: 0, endTime: 0 },
    { original: 'かきくけこ', translation: '', startTime: 0, endTime: 0 },
    { original: 'さしすせそ', translation: '', startTime: 0, endTime: 0 },
  ]
  const words = [w('あいうえお', 1, 4), w('かきくけこ', 6, 9), w('さしすせそ', 11, 14)]

  const goodCount = (r: ReturnType<typeof refineAlignmentWithPhrases>) =>
    (r.lineAlignmentQuality ?? []).filter((q) => q === 'good').length

  it('an all-silent signal strictly reduces the good count (signal reaches the gate)', () => {
    const base = goodCount(refineAlignmentWithPhrases(sheet, words, 'ja'))
    expect(base).toBeGreaterThan(0) // sanity: this trivial exact-match sheet has good lines
    const withSig = goodCount(refineAlignmentWithPhrases(sheet, words, 'ja', undefined, { vocalActivity: allSilent() }))
    expect(withSig).toBeLessThan(base) // acoustic gate demoted good→approximate
  })

  it('keeps timings/shape identical (label-only)', () => {
    const base = refineAlignmentWithPhrases(sheet, words, 'ja')
    const withSig = refineAlignmentWithPhrases(sheet, words, 'ja', undefined, { vocalActivity: allSilent() })
    expect(withSig.lines.map((l) => [l.startTime, l.endTime])).toEqual(base.lines.map((l) => [l.startTime, l.endTime]))
  })
})
```
(If `base` has 0 'good' lines on this trivial sheet — unlikely for exact-match content — add lines / tighten the transcript so at least one line scores 'good', since the point is proving demotion flows through.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.integration.test.ts`
Expected: FAIL — `vocalActivity` isn't passed to `applyLabelHonesty` yet.

- [ ] **Step 3: Wire the single-pass call** (`src/lyrics/phraseAlignment.ts`, the `applyLabelHonesty({...})` at line ~2099). Add `vocalActivity: options?.vocalActivity,` to the input object:

```ts
    : applyLabelHonesty({
        lines: tunedLines,
        lineTexts,
        quality: lineAlignmentQuality,
        words: transcriptWords,
        mode: pass1.mode,
        spans: upgradeSpans,
        vocalActivity: options?.vocalActivity,
      })
```

- [ ] **Step 4: Wire the merged call** (`src/ai-pipeline/mixedLanguageAlign.ts`, the `applyLabelHonesty({...})` at line ~242). Add `vocalActivity,` (the new param from Task 2):

```ts
  refined.lineAlignmentQuality = applyLabelHonesty({
    lines: cappedLines,
    lineTexts,
    quality: refined.lineAlignmentQuality ?? [],
    words: sanitizeTranscript(transcriptWords),
    mode: refined.mode,
    vocalActivity,
  })
```

- [ ] **Step 5: Run the integration test + full suite**

Run: `npx vitest run tests/ai-pipeline/vocalActivity.integration.test.ts && npx vitest run && npx tsc --noEmit`
Expected: integration passes; full suite green (no-signal callers unchanged).

- [ ] **Step 6: Corpus baseline unchanged (signal-absent path)**

Run: `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: `✓ No regressions vs baseline.` (the corpus runs without envelopes → identical).

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/phraseAlignment.ts src/ai-pipeline/mixedLanguageAlign.ts tests/ai-pipeline/vocalActivity.integration.test.ts
git commit --no-gpg-sign -m "feat(align): pass vocalActivity into single-pass and merged label-honesty"
```

---

## Task 5: Compute + inject the envelope in `AutoAlignFlow`

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`

This is the fresh-align wiring. It has no unit test (the flow orchestrates workers/UI); correctness is guarded by `tsc`, the seam being wired exactly, and the live e2e (Task 8 of the guardrail / manual verification). Keep the change minimal and defensive (a compute failure must NOT break alignment).

- [ ] **Step 1: Import the DSP** — add near the other `../ai-pipeline` imports:
```ts
import { computeVocalActivity } from './vocalActivity'
```

- [ ] **Step 2: Compute the envelope once, right after the Demucs block** (after line ~219, where `audioData`/`sampleRate` are finalized to the stem-or-mix). Wrap in try/catch so a DSP failure degrades to today's text-only behavior:
```ts
      let vocalActivity: ReturnType<typeof computeVocalActivity> | undefined
      try {
        vocalActivity = computeVocalActivity(audioData, sampleRate, { source: willSeparate ? 'stem' : 'mix' })
      } catch {
        vocalActivity = undefined // acoustic gate simply won't fire
      }
```

- [ ] **Step 3: Inject at the mixed align site** (line ~365):
```ts
        const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaTranscript), chunksToWords(enTranscript), vocalActivity)
```

- [ ] **Step 4: Inject at the single-language align site** (line ~379):
```ts
        refined = refineAlignmentWithPhrases(
          sheetRows,
          words,
          alignmentLanguage,
          song.lyrics,
          { vocalActivity },
        )
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; green. (AutoAlignFlow has component tests under tests/; confirm they still pass.)

- [ ] **Step 6: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit --no-gpg-sign -m "feat(align): compute the vocal-activity envelope at fresh-align and feed the aligner"
```

---

## Task 6: `make-vocal-activity.mjs` + a synthetic corpus envelope fixture

**Files:**
- Create: `scripts/make-vocal-activity.mjs`
- Create: `tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json` (synthetic, committed)

- [ ] **Step 1: Write the derivation script** `scripts/make-vocal-activity.mjs`:

```js
/**
 * Derive a committed vocal-activity envelope fixture from a local MP3.
 * The output is a lossy energy curve (NOT the audio) → not a copyrighted
 * reproduction. Run once per corpus song you have locally (via tsx, since it
 * imports the TS DSP module):
 *   npx tsx scripts/make-vocal-activity.mjs <input.mp3> <song-name> [--stem]
 * Writes tests/ai-pipeline/fixtures/vocal-activity/<song-name>.json.
 * Use --stem only if <input.mp3> is already a Demucs vocal isolate.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const [input, name] = process.argv.slice(2)
const source = process.argv.includes('--stem') ? 'stem' : 'mix'
if (!input || !name) { console.error('usage: node scripts/make-vocal-activity.mjs <input.mp3> <song-name> [--stem]'); process.exit(1) }

const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { computeVocalActivity } = await import(pathToFileURL(join(root, 'src/ai-pipeline/vocalActivity.ts')).href)

const { data, sampleRate } = await decodeMp3ToMono(input)
const sig = computeVocalActivity(data, sampleRate, { source })
const outDir = join(root, 'tests/ai-pipeline/fixtures/vocal-activity')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `${name}.json`)
// Store as plain arrays (round to 3dp to keep the file small + stable).
const round = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000)
writeFileSync(out, JSON.stringify({ hopSec: sig.hopSec, source: sig.source, activity: round(sig.activity), onset: round(sig.onset) }))
console.log(`Wrote ${out} (${sig.activity.length} frames @ ${sig.hopSec.toFixed(4)}s, source=${sig.source})`)
```

- [ ] **Step 2: Author the synthetic guard fixture.** The `akfg-instrumental` fixture has a known instrumental break where lyrics get hallucinated (see the round-12 fixture: evidence hole ~214–299s, a 7s hallucinated segment at ~237s). Create `tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json` as a deterministic envelope that is **voiced (1.0) everywhere except a silent (0.0) window covering the break**, at `hopSec: 0.02`. Generate it with this one-off node snippet (run it, commit the file it writes):

```bash
node -e '
const fs=require("node:fs"); const hopSec=0.02; const durSec=300; const frames=Math.ceil(durSec/hopSec);
const activity=new Array(frames).fill(1); const onset=new Array(frames).fill(0);
// instrumental break 214–260s → silent (covers the hallucinated 237s segment)
for(let f=Math.floor(214/hopSec); f<Math.ceil(260/hopSec)&&f<frames; f++) activity[f]=0;
fs.mkdirSync("tests/ai-pipeline/fixtures/vocal-activity",{recursive:true});
fs.writeFileSync("tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json", JSON.stringify({hopSec,source:"mix",activity,onset}));
console.log("wrote synthetic akfg-instrumental envelope", frames, "frames");
'
```
(This synthetic envelope validates the audit plumbing + the gate end-to-end deterministically. Real per-song envelopes come from Step 1 on the user's local MP3s.)

- [ ] **Step 3: Sanity-check the fixture loads + parses**

Run: `node -e "const j=require('./tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json'); console.log('frames', j.activity.length, 'hopSec', j.hopSec, 'source', j.source, 'silentAt220s', j.activity[Math.floor(220/j.hopSec)])"`
Expected: prints a frame count, `hopSec 0.02`, `source mix`, and `silentAt220s 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/make-vocal-activity.mjs tests/ai-pipeline/fixtures/vocal-activity/akfg-instrumental.json
git commit --no-gpg-sign -m "feat(align): envelope derivation script + synthetic akfg-instrumental guard fixture"
```

---

## Task 7: Acoustic pass + metrics in `audit-corpus.mjs`

**Files:**
- Modify: `scripts/audit-corpus.mjs`
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (acoustic columns snapshot)

The existing signal-absent pass and its metric columns stay exactly as they are (ratcheted). We ADD an acoustic pass + columns that are populated only when an envelope fixture exists for the song.

- [ ] **Step 1: Add an envelope loader + acoustic pass in the per-song loop.** In `scripts/audit-corpus.mjs`, near the other fixture loads at the top of the `for (const song of manifest.songs)` loop (after `refined` is computed, ~line 165), add:

```js
    // Acoustic pass: when a committed vocal-activity envelope exists for this
    // song, re-run alignment WITH the signal and count the good→approximate
    // demotions it produces (the false-positive catches). Signal-absent columns
    // above are untouched.
    let acoustic_demoted = ''
    const vaPath = join(FIXTURES, 'vocal-activity', `${song.name}.json`)
    if (existsSync(vaPath)) {
      const va = JSON.parse(readFileSync(vaPath, 'utf8'))
      const sig = { hopSec: va.hopSec, source: va.source, activity: Float32Array.from(va.activity), onset: Float32Array.from(va.onset ?? []) }
      const acoustic = song.transcriptEn
        ? refineMixedLanguageAlignment(sheetRows, loadTranscriptWords(join(FIXTURES, song.transcript)), loadTranscriptWords(join(FIXTURES, song.transcriptEn)), sig).refined
        : refineAlignmentWithPhrases(sheetRows, loadTranscriptWords(join(FIXTURES, song.transcript)), song.lang, undefined, { vocalActivity: sig })
      const baseGood = (refined.lineAlignmentQuality ?? []).filter((q) => q === 'good').length
      const acGood = (acoustic.lineAlignmentQuality ?? []).filter((q) => q === 'good').length
      acoustic_demoted = baseGood - acGood
    }
```
(Ensure `existsSync`, `readFileSync` are imported at the top of the file — add them to the existing `node:fs` import if absent. `refineMixedLanguageAlignment` and `refineAlignmentWithPhrases` are already imported.)

- [ ] **Step 2: Add the column to the scorecard row** — in the `scorecard[song.name] = { ... }` object (~line 228), add:
```js
      acoustic_demoted,
```

- [ ] **Step 3: Run the audit and confirm the column populates only for the fixture song**

Run: `npx tsx scripts/audit-corpus.mjs`
Expected: a new `acoustic_demoted` column; blank for songs without an envelope; for `akfg-instrumental-word` (which has the synthetic fixture) a **positive** number (the break lines that were 'good' without the signal are demoted with it). If it's 0, the synthetic break window doesn't overlap any 'good' line's placed window — widen the fixture's silent window (Task 6 Step 2) to cover where the hallucinated lines actually land, then re-run.

- [ ] **Step 4: Snapshot the new column into the baseline + verify the guard**

Run: `npx tsx scripts/audit-corpus.mjs --write-baseline && npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: writes the baseline (now including `acoustic_demoted`), then `✓ No regressions vs baseline.` Confirm via `git diff tests/ai-pipeline/fixtures/corpus-baseline.json` that ONLY the `acoustic_demoted` column was added and no pre-existing metric value changed.

- [ ] **Step 5: Run the corpus scorecard CI test**

Run: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts`
Expected: PASS (the ratchet now includes the acoustic column; pre-existing metrics unchanged).

- [ ] **Step 6: Commit**

```bash
git add scripts/audit-corpus.mjs tests/ai-pipeline/fixtures/corpus-baseline.json
git commit --no-gpg-sign -m "feat(align): audit-corpus acoustic pass — count break-hallucination demotions"
```

---

## Final verification

- [ ] Full suite: `npx vitest run` → green.
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Corpus: `npx tsx scripts/audit-corpus.mjs --check-baseline` → `✓ No regressions vs baseline.` (existing metrics byte-identical; `acoustic_demoted` guarded).
- [ ] Live (fresh-align, dev server): align a from-scratch pasted-lyrics song with an obvious instrumental intro/break **with "Isolate vocals for timing" ON** → confirm intro/break lines that used to read confidently now read approximate (honest off-timing banner), and clean lines are unaffected. Then repeat with separation OFF → confirm no confident *correct* lines got demoted (corroborate-don't-override held). Report console + screenshots.
- [ ] User action documented: to CI-guard real corpus songs, run `node scripts/make-vocal-activity.mjs <mp3> <song-name>` on the local corpus MP3s, then `npx tsx scripts/audit-corpus.mjs --write-baseline`.

## Self-review notes (author)

- **Spec coverage:** signal module (T1); threading (T2, T4, T5); acoustic gate = hooks (a)+(c) unified as label demotion (T3); guardrail = synthetic tests (T1/T3/T4) + derivation script + synthetic fixture (T6) + audit acoustic pass/metrics/ratchet (T7); safety invariant (no-signal = today) verified in T2/T4/T5 full-suite + corpus-baseline steps; corroborate-don't-override in T3 (mix + strong coverage spared, stem decisive).
- **Design refinement vs spec:** the spec framed hooks (a) reject-placement and (c) recalibrate-confidence as two hooks; both collapse to a single acoustic demotion gate in `applyLabelHonesty` (label-only, downward, once on the merged result), which is lower-risk than surgery inside `redistributeDegenerateRuns` and matches the spec's stated outcome ("degrade to honest approximate"). Re-timing lines off the break is explicitly phase 2 (onset-snapping).
- **Deferred (phase 2 / spec):** onset snapping; gap-recovery slice envelopes; persisting envelopes for stored re-refine; a VAD model for cleaner raw-mix accuracy.
- **Type consistency:** `VocalActivitySignal` from `vocalActivity.ts`; `voicedFraction`/`meanActivity`/`VOICED_THRESHOLD` exported there; `AlignLyricsOptions.vocalActivity?` and `LabelHonestyInput.vocalActivity?` and `refineMixedLanguageAlignment(..., vocalActivity?)` all reference that one type.
