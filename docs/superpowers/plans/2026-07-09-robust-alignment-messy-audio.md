# Robust Alignment on Messy Audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the line- and word-level aligners robust on songs with imperfect audio, mixed JA/EN lyrics, and overlapping vocalists — redistribution of degenerate runs, messy-transcript tolerance, phonetic EN fallback, and mixed-language transcription.

**Architecture:** Three components layered onto the existing tuner chain in `refineAlignmentWithPhrases` (src/lyrics/phraseAlignment.ts): (C1) a final redistribution pass that re-times pileups/compressions/absorptions across transcript activity regions; (C2) `sanitizeTranscript` tolerance for interleaved dual-vocalist streams + a phonetic-skeleton fallback matcher for English lines; (C3) per-chunk Whisper language auto-detection for mixed-language sheets, empirically gated by a node re-transcription experiment. The corpus scorecard (`scripts/audit-corpus.mjs` + baseline guard) is the regression harness throughout.

**Tech Stack:** TypeScript, vitest, tsx, @xenova/transformers (node experiment), existing corpus fixtures in `tests/ai-pipeline/fixtures/`.

**Spec:** `docs/superpowers/specs/2026-07-09-robust-alignment-messy-audio-design.md`

**Key reference points in the existing code:**
- Tuner chain: `src/lyrics/phraseAlignment.ts:1657` (`refineAlignmentWithPhrases`); last boundary tuner is `backfillLateStartsToMatchedSpan` (line ~1695), followed by `expandSquashedLineHighlights`, then `recomputeLineQuality` and the needs_review→approximate upgrade blocks.
- `sanitizeTranscript`: `src/ai-pipeline/aligner.ts:96` — currently **drops** any word whose start goes backwards (lines 67 and 122), which discards an overlapping second vocalist's entire stream.
- Line scoring: `scoreLineAlignment`, `computeLineMatchedSpans`, `normalizeForMatch` in `src/ai-pipeline/contentAligner.ts`.
- Observed failure rows (stranger-than-heaven-word fixture): pileup lines 44–50 (all at 153.88–154.18), absorption line 53 (163.44–202.42, 39s), compressions lines 19–21 and 38–43.
- Corpus runner: `npx tsx scripts/audit-corpus.mjs` (alignment metrics computed at scripts/audit-corpus.mjs:145-158); baseline guard test `tests/ai-pipeline/corpus-scorecard.test.ts`.
- Test runner: `npx vitest run <file>` from the repo root.

---

### Task 1: Degeneracy helpers module

**Files:**
- Create: `src/lyrics/lineDegeneracy.ts`
- Test: `tests/lyrics/lineDegeneracy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lyrics/lineDegeneracy.test.ts
import { describe, it, expect } from 'vitest'
import {
  expectedLineDuration,
  minLineDuration,
  findActivityRegions,
} from '../../src/lyrics/lineDegeneracy'

describe('expectedLineDuration', () => {
  it('scales JA lines by character count', () => {
    // 12 JA chars * 0.25s = 3.0s
    expect(expectedLineDuration('ただただ荒れていく時代に', 'ja')).toBeCloseTo(3.0, 1)
  })
  it('scales EN lines by word count', () => {
    // 8 words * 0.4s = 3.2s
    expect(expectedLineDuration('I found a place where I am not', 'ja')).toBeCloseTo(3.2, 1)
  })
  it('clamps to [0.8, 12]', () => {
    expect(expectedLineDuration('あ', 'ja')).toBe(0.8)
    expect(expectedLineDuration('あ'.repeat(200), 'ja')).toBe(12)
  })
})

describe('minLineDuration', () => {
  it('mirrors the minSungSpan floor (0.14s per normalized glyph, clamped)', () => {
    expect(minLineDuration('ただただ荒れていく時代に')).toBeCloseTo(12 * 0.14, 2)
    expect(minLineDuration('あ')).toBe(0.8)
  })
})

describe('findActivityRegions', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })
  it('merges words separated by small gaps into one region', () => {
    const regions = findActivityRegions([w('a', 10, 11), w('b', 12, 13), w('c', 14.5, 15)], 9, 20)
    expect(regions).toEqual([{ start: 10, end: 15 }])
  })
  it('splits at gaps longer than maxGapS (instrumental)', () => {
    const regions = findActivityRegions([w('a', 10, 11), w('b', 20, 21)], 9, 25)
    expect(regions).toEqual([
      { start: 10, end: 11 },
      { start: 20, end: 21 },
    ])
  })
  it('clips regions to the window and ignores words outside it', () => {
    const regions = findActivityRegions([w('a', 5, 8), w('b', 9, 11), w('c', 30, 31)], 10, 20)
    expect(regions).toEqual([{ start: 10, end: 11 }])
  })
  it('returns [] when the window has no words', () => {
    expect(findActivityRegions([w('a', 5, 6)], 10, 20)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/lineDegeneracy.test.ts`
Expected: FAIL — module `src/lyrics/lineDegeneracy` not found.

- [ ] **Step 3: Implement the module**

```ts
// src/lyrics/lineDegeneracy.ts
import type { Language } from '../core/types'
import { lineWeight, type TranscriptWord } from '../ai-pipeline/aligner'
import { normalizeForMatch } from '../ai-pipeline/contentAligner'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** Rough duration a line should take to sing. `lineWeight` counts JA characters
 * (≈ morae) or EN words, which sing at very different rates — ~0.25s per JA
 * char, ~0.4s per EN word. Clamped: no line plausibly sings under 0.8s or over 12s. */
export function expectedLineDuration(text: string, sourceLanguage: Language): number {
  const weight = Math.max(1, lineWeight(text, sourceLanguage))
  const unit = JA_SCRIPT_RE.test(text) ? 0.25 : 0.4
  return Math.min(12, Math.max(0.8, weight * unit))
}

/** Lower bound on a plausible sung span (mirrors phraseAlignment's minSungSpan). */
export function minLineDuration(text: string): number {
  const glyphs = normalizeForMatch(text).length
  return Math.max(0.8, Math.min(4.5, glyphs * 0.14))
}

export interface ActivityRegion {
  start: number
  end: number
}

/** Sub-spans of [windowStart, windowEnd] where transcript words exist. Gaps
 * longer than maxGapS are instrumental breaks and split regions, so lines
 * redistributed onto activity never claim dead air. Words must be sorted by
 * startTime (sanitizeTranscript output is). */
export function findActivityRegions(
  words: TranscriptWord[],
  windowStart: number,
  windowEnd: number,
  maxGapS = 4,
): ActivityRegion[] {
  const regions: ActivityRegion[] = []
  for (const w of words) {
    if (w.endTime <= windowStart || w.startTime >= windowEnd) continue
    const start = Math.max(w.startTime, windowStart)
    const end = Math.min(w.endTime, windowEnd)
    const last = regions[regions.length - 1]
    if (last && start - last.end <= maxGapS) last.end = Math.max(last.end, end)
    else regions.push({ start, end })
  }
  return regions.filter((r) => r.end - r.start > 0.2)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/lineDegeneracy.test.ts`
Expected: PASS (all cases). If the `findActivityRegions` merge test fails on exact equality, check gap arithmetic — `12 - 11 = 1 ≤ 4` merges, `20 - 11 = 9 > 4` splits.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/lineDegeneracy.ts tests/lyrics/lineDegeneracy.test.ts
git commit -m "feat(alignment): line degeneracy helpers (expected duration, activity regions)"
```

---

### Task 2: Scorecard metrics `align_pileup` and `align_compressed`

**Files:**
- Modify: `scripts/audit-corpus.mjs` (alignment metrics block, ~lines 145–158, and the scorecard row assembly below it)
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (via `--write-baseline`)

- [ ] **Step 1: Add the metrics to the alignment block**

In `scripts/audit-corpus.mjs`, import the helpers at the top of `main()` alongside the other dynamic imports:

```js
const { minLineDuration } = await import(
  pathToFileURL(join(root, 'src/lyrics/lineDegeneracy.ts')).href
)
```

Then in the alignment-metrics loop (where `zeroDur`/`longDur`/`monotonicity` are counted), add:

```js
let pileup = 0
let compressed = 0
for (let i = 0; i < refined.lines.length; i++) {
  const l = refined.lines[i]
  const dur = l.endTime - l.startTime
  const text = l.original || l.translation
  if (i > 0 && l.startTime - refined.lines[i - 1].startTime < 0.4) pileup++
  if (dur > 0 && dur < minLineDuration(text) * 0.55) compressed++
}
```

Add `align_pileup: pileup, align_compressed: compressed` to the song's scorecard row next to the existing `align_*` keys (follow the exact object shape used for `align_zero_dur`).

- [ ] **Step 2: Run the scorecard and verify the new columns show the known badness**

Run: `npx tsx scripts/audit-corpus.mjs`
Expected: new `align_pileup` / `align_compressed` columns appear; `stranger-than-heaven-word` shows a clearly non-zero pileup count (the 44–50 run plus 38–43 gives roughly 8–12) while `veil` and `my-eyes-only` stay at or near 0. Record the exact numbers in the commit message.

- [ ] **Step 3: Snapshot the baseline (locks current badness so later tasks must improve it)**

Run: `npx tsx scripts/audit-corpus.mjs --write-baseline`
Then: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts`
Expected: PASS. If the guard test errors on the new keys, extend its metric list the same way `unscoreable` was added (grep for `unscoreable` in the test to find the pattern).

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-corpus.mjs tests/ai-pipeline/fixtures/corpus-baseline.json tests/ai-pipeline/corpus-scorecard.test.ts
git commit -m "feat(audit): align_pileup + align_compressed scorecard metrics"
```

---

### Task 3: Redistribution pass — core algorithm (synthetic tests)

**Files:**
- Create: `src/lyrics/redistributeDegenerateRuns.ts`
- Modify: `src/lyrics/phraseAlignment.ts` — export `transcriptWindowForLine`, `LINE_VALIDATE_WINDOW_LEAD_S`, `LINE_VALIDATE_WINDOW_TAIL_S` (add `export` keywords; they are currently private)
- Test: `tests/lyrics/redistributeDegenerateRuns.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lyrics/redistributeDegenerateRuns.test.ts
import { describe, it, expect } from 'vitest'
import { redistributeDegenerateRuns } from '../../src/lyrics/redistributeDegenerateRuns'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
// Transcript words matching the anchor lines verbatim so scoreLineAlignment
// rates them 'good'; the middle lines have no transcript support.
const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })

function anchorWords(text: string, start: number, end: number) {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

describe('redistributeDegenerateRuns', () => {
  it('spreads a pileup run across the activity between its anchors', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      // unmatched singing (activity) in the gap:
      ...anchorWords('mumble garble noise hums here and more of it still', 15, 25),
      ...anchorWords('every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      // three-line pileup at a point:
      line('Something whisper misheard entirely first', 14, 14.2),
      line('Something whisper misheard entirely second', 14.2, 14.4),
      line('Something whisper misheard entirely third', 14.4, 14.6),
      line('Every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 4)).toEqual([true, true, true])
    // Spread out: consecutive starts at least 0.4s apart, inside the anchor gap.
    for (let i = 2; i <= 3; i++) {
      expect(res.lines[i].startTime - res.lines[i - 1].startTime).toBeGreaterThanOrEqual(0.4)
    }
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14)
    expect(res.lines[3].endTime).toBeLessThanOrEqual(30)
    // Lands on transcript activity (15–25), not the silent 25–30 stretch.
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14.9)
    expect(res.onActivity.slice(1, 4)).toEqual([true, true, true])
    // Anchored neighbors untouched.
    expect(res.lines[0]).toMatchObject({ startTime: 10, endTime: 14 })
    expect(res.lines[4]).toMatchObject({ startTime: 30, endTime: 34 })
  })

  it('shrinks an absorbed line instead of letting it span an instrumental', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('hums and noise right here', 14.5, 18),
      // 30s instrumental gap: no words 18–48
      ...anchorWords('every good boy deserves fudge and cake at the party', 48, 52),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Some middle line the transcript missed', 14.5, 47.5), // 33s absorption
      line('Every good boy deserves fudge and cake at the party', 48, 52),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed[1]).toBe(true)
    const dur = res.lines[1].endTime - res.lines[1].startTime
    expect(dur).toBeLessThanOrEqual(6) // ≈ expected duration for 6 EN words, ≤ 1.5× stretch
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14)
    expect(res.lines[1].endTime).toBeLessThanOrEqual(18.5) // sits on the 14.5–18 activity
  })

  it('is a no-op on sane, well-spaced lines', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('every good boy deserves fudge and cake at the party', 16, 20),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Every good boy deserves fudge and cake at the party', 16, 20),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed).toEqual([false, false])
    expect(res.lines).toEqual(lines)
  })

  it('spreads evenly across the window when there is no activity, flagged off-activity', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Ghost line one with several words', 14, 14.1),
      line('Ghost line two with several words', 14.1, 14.2),
      line('Every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 3)).toEqual([true, true])
    expect(res.onActivity.slice(1, 3)).toEqual([false, false])
    expect(res.lines[2].startTime).toBeGreaterThan(res.lines[1].startTime + 0.4)
    expect(res.lines[2].endTime).toBeLessThanOrEqual(30)
  })

  it('returns input untouched when the transcript is empty', () => {
    const lines = [line('abc', 0, 0), line('def', 0, 0)]
    const res = redistributeDegenerateRuns(lines, [], 'ja')
    expect(res.lines).toEqual(lines)
    expect(res.redistributed).toEqual([false, false])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/redistributeDegenerateRuns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Export the window helpers from phraseAlignment**

In `src/lyrics/phraseAlignment.ts` add `export` to `transcriptWindowForLine` (line ~1312) and to the `LINE_VALIDATE_WINDOW_LEAD_S` / `LINE_VALIDATE_WINDOW_TAIL_S` constants (grep for their declarations near the top of the file).

- [ ] **Step 4: Implement the pass**

```ts
// src/lyrics/redistributeDegenerateRuns.ts
import type { Language, TimedLine } from '../core/types'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import { scoreLineAlignment } from '../ai-pipeline/contentAligner'
import {
  transcriptWindowForLine,
  LINE_VALIDATE_WINDOW_LEAD_S,
  LINE_VALIDATE_WINDOW_TAIL_S,
} from './phraseAlignment'
import { expectedLineDuration, minLineDuration, findActivityRegions, type ActivityRegion } from './lineDegeneracy'

/** Consecutive starts closer than this are a pileup. */
const PILEUP_GAP_S = 0.4
/** A span under this fraction of the per-text floor is compressed. */
const COMPRESSION_FRACTION = 0.55
/** A span over max(18s, 2.5× expected) is an absorption. */
const ABSORPTION_FACTOR = 2.5
const ABSORPTION_MIN_S = 18
/** Redistributed lines never stretch beyond 1.5× their expected duration. */
const MAX_STRETCH = 1.5

export interface RedistributionResult {
  lines: TimedLine[]
  /** True where the pass re-timed the line. */
  redistributed: boolean[]
  /** True where the re-timed span overlaps transcript activity. */
  onActivity: boolean[]
}

function lineTextOf(l: TimedLine): string {
  return l.original || l.translation
}

/** Map a position on the concatenated-activity virtual timeline to real time. */
function virtualToReal(regions: ActivityRegion[], t: number): number {
  let acc = 0
  for (const r of regions) {
    const d = r.end - r.start
    if (t <= acc + d) return r.start + (t - acc)
    acc += d
  }
  return regions[regions.length - 1]?.end ?? 0
}

function runIsDegenerate(
  lines: TimedLine[],
  from: number,
  to: number,
  sourceLanguage: Language,
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
 */
export function redistributeDegenerateRuns(
  linesIn: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
): RedistributionResult {
  const lines = linesIn.map((l) => ({ ...l }))
  const redistributed = lines.map(() => false)
  const onActivity = lines.map(() => false)
  const clean = sanitizeTranscript(words)
  if (clean.length === 0 || lines.length === 0) return { lines, redistributed, onActivity }
  const lastTime = clean[clean.length - 1].endTime

  const anchored = lines.map((l, i) => {
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

function redistributeRun(
  lines: TimedLine[],
  from: number,
  to: number,
  clean: TranscriptWord[],
  sourceLanguage: Language,
  lastTime: number,
  redistributed: boolean[],
  onActivity: boolean[],
): void {
  if (!runIsDegenerate(lines, from, to, sourceLanguage)) return
  const windowStart = from > 0 ? lines[from - 1].endTime : 0
  const windowEnd = to + 1 < lines.length ? lines[to + 1].startTime : lastTime
  if (windowEnd - windowStart < 0.5) return

  const weights: number[] = []
  for (let k = from; k <= to; k++) {
    weights.push(expectedLineDuration(lineTextOf(lines[k]), sourceLanguage))
  }
  const totalExpected = weights.reduce((a, b) => a + b, 0)
  const regions = findActivityRegions(clean, windowStart, windowEnd)

  if (regions.length === 0) {
    // No transcript support at all: spread evenly over the window (still far
    // better than a pileup), capped so lines don't balloon in a huge gap.
    const scale = Math.min(MAX_STRETCH, (windowEnd - windowStart) / totalExpected)
    let cursor = windowStart
    for (let k = from; k <= to; k++) {
      const dur = weights[k - from] * scale
      lines[k].startTime = cursor
      lines[k].endTime = Math.min(windowEnd, cursor + dur)
      cursor = lines[k].endTime
      redistributed[k] = true
      onActivity[k] = false
    }
    return
  }

  const capacity = regions.reduce((a, r) => a + (r.end - r.start), 0)
  const scale = Math.min(MAX_STRETCH, capacity / totalExpected)
  let virt = 0
  for (let k = from; k <= to; k++) {
    const dur = weights[k - from] * scale
    const start = virtualToReal(regions, virt)
    const end = virtualToReal(regions, Math.min(capacity, virt + dur))
    lines[k].startTime = start
    lines[k].endTime = Math.max(end, start)
    virt = Math.min(capacity, virt + dur)
    redistributed[k] = true
    onActivity[k] = clean.some((w) => w.startTime < lines[k].endTime && w.endTime > lines[k].startTime)
  }
  // Monotonic within the run and against the neighbours by construction
  // (virtual timeline is monotonic; window is bounded by neighbour times).
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/redistributeDegenerateRuns.test.ts`
Expected: PASS. Most likely failure: the synthetic anchor lines don't score `good` (coverage below `LINE_QUALITY_MIN_COVERAGE = 0.55`). If so, make the anchor line text and its transcript words identical, longer (10+ words), and re-run — the LCS coverage must clear 0.55.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/redistributeDegenerateRuns.ts src/lyrics/phraseAlignment.ts tests/lyrics/redistributeDegenerateRuns.test.ts
git commit -m "feat(alignment): redistribute degenerate line runs across transcript activity"
```

---

### Task 4: Wire redistribution into the tuner chain + stranger fixture tests

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts` (`refineAlignmentWithPhrases`, ~line 1695)
- Test: `tests/ai-pipeline/lineBoundary.redistribution.test.ts`
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (re-snapshot)

- [ ] **Step 1: Write the failing fixture test**

Follow the loader pattern from `tests/ai-pipeline/lineBoundary.latestart-backfill.test.ts` (copy its `loadWords` / `loadLines` / `refineFor` helpers verbatim).

```ts
// tests/ai-pipeline/lineBoundary.redistribution.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))

function loadWords(p: string) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = w.word?.trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime as number, endTime: w.endTime as number }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}

function refineFor(lyricsPath: string, transcriptPath: string) {
  const lineTexts = readFileSync(lyricsPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const words = loadWords(transcriptPath)
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return { lineTexts, refined: refineAlignmentWithPhrases(sheetRows, words, 'ja') }
}

// Graceful degradation (spec C1): runs of unanchorable lines must not pile up
// at a point, get squeezed to slivers, or absorb an instrumental. Stranger's
// bridge (rows 44-50) piled six lines into 153.88-154.18; row 53 absorbed 39s.
describe('line boundary: degenerate-run redistribution', () => {
  const dir = join(here, 'fixtures/stranger-than-heaven')
  it('stranger word-mode: no two consecutive non-blank lines share a start (pileups spread)', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    let pileups = 0
    for (let i = 1; i < refined.lines.length; i++) {
      if (!refined.lines[i].original.trim() || !refined.lines[i - 1].original.trim()) continue
      if (refined.lines[i].startTime - refined.lines[i - 1].startTime < 0.4) pileups++
    }
    expect(pileups).toBeLessThanOrEqual(2) // baseline was ~10
  })
  it('stranger word-mode: no line lasts longer than 18s (absorption shrunk)', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    for (const l of refined.lines) {
      expect(l.endTime - l.startTime, `"${l.original}"`).toBeLessThanOrEqual(18)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ai-pipeline/lineBoundary.redistribution.test.ts`
Expected: FAIL — pileup count ~10, and line 53 spans ~39s.

- [ ] **Step 3: Wire the pass into `refineAlignmentWithPhrases`**

In `src/lyrics/phraseAlignment.ts`, import at the top:

```ts
import { redistributeDegenerateRuns } from './redistributeDegenerateRuns'
```

In `refineAlignmentWithPhrases`, after `tunedLines = backfillLateStartsToMatchedSpan(tunedLines, words)` and **before** `expandSquashedLineHighlights`:

```ts
const redist = redistributeDegenerateRuns(tunedLines, words, sourceLanguage)
tunedLines = redist.lines
```

Then, after the existing partial-anchor upgrade block (the last `lineAlignmentQuality[i] = 'approximate'` loop, ~line 1745), add:

```ts
// Redistributed lines that landed on transcript activity have plausible,
// evidence-adjacent timing; review can't do better than the redistribution
// already did, so they read approximate. Off-activity placements stay flagged.
for (let i = 0; i < tunedLines.length; i++) {
  if (lineAlignmentQuality[i] !== 'needs_review') continue
  if (redist.redistributed[i] && redist.onActivity[i]) lineAlignmentQuality[i] = 'approximate'
}
```

- [ ] **Step 4: Run the new test and the full alignment test suite**

Run: `npx vitest run tests/ai-pipeline/lineBoundary.redistribution.test.ts`
Expected: PASS.

Run: `npx vitest run tests/ai-pipeline/ tests/lyrics/`
Expected: PASS. If a lineBoundary or akfg test regresses, the redistribution touched an anchored line — check the `anchored` computation (quality must be `good` for every line the older tests pin) and tighten `runIsDegenerate` rather than loosening the failing test.

- [ ] **Step 5: Verify word-level (phrase) timings follow the redistribution**

Word-level playback sync comes from `refined.phrases`, synced from lines by `syncPhrasesFromValidatedLines` — which already runs AFTER the tuner chain, so redistributed line times propagate automatically. Verify by adding to `tests/ai-pipeline/lineBoundary.redistribution.test.ts`:

```ts
  it('stranger word-mode: phrase timings track the redistributed lines', { timeout: 30_000 }, () => {
    const { refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    for (const p of refined.phrases) {
      if (p.sourceLineIndices.length !== 1) continue
      const l = refined.lines[p.sourceLineIndices[0]]
      expect(p.startTime).toBeCloseTo(l.startTime, 2)
      expect(p.endTime).toBeCloseTo(l.endTime, 2)
    }
  })
```

Run: `npx vitest run tests/ai-pipeline/lineBoundary.redistribution.test.ts` — expected PASS with no production change. If it fails, the sync call ordering in `refineAlignmentWithPhrases` moved — ensure `syncPhrasesFromValidatedLines(phrases, tunedLines)` receives the post-redistribution `tunedLines`.

- [ ] **Step 6: Check the scorecard and re-snapshot**

Run: `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: `align_pileup`/`align_compressed`/`align_long_dur` improve on stranger; **zero regressions** on veil / akfg / my-eyes-only / guitar-loneliness rows. Then:

Run: `npx tsx scripts/audit-corpus.mjs --write-baseline && npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/ai-pipeline/lineBoundary.redistribution.test.ts tests/ai-pipeline/fixtures/corpus-baseline.json
git commit -m "feat(alignment): wire degenerate-run redistribution into the tuner chain"
```

---

### Task 5: Tolerate interleaved dual-vocalist transcript streams (C2a)

**Files:**
- Modify: `src/ai-pipeline/aligner.ts` (`pushSanitizedWord` line ~65, `sanitizeTranscript` line ~96)
- Test: `tests/ai-pipeline/aligner.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing tests**

Add to `tests/ai-pipeline/aligner.test.ts` (match its existing import style):

```ts
describe('sanitizeTranscript: overlapping vocalists', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })

  it('keeps a second interleaved stream with slightly-backward timestamps, sorted', () => {
    // Two vocalists singing simultaneously: Whisper emits stream A then stream B
    // with timestamps that rewind by ~1s (observed on stranger-than-heaven 143-145s).
    const words = [
      w('Ill', 143.06, 143.3), w('find', 143.32, 143.62), w('a', 143.62, 143.92), w('place', 143.92, 144.58),
      w('Find', 143.38, 143.68), w('a', 143.68, 143.9), w('face', 143.9, 144.8), // rewinds 1.2s
      w('That', 145.32, 145.68), w('I', 145.68, 145.88),
    ]
    const clean = sanitizeTranscript(words)
    expect(clean.map((x) => x.word)).toContain('face') // second stream kept
    for (let i = 1; i < clean.length; i++) {
      expect(clean[i].startTime).toBeGreaterThanOrEqual(clean[i - 1].startTime) // sorted
    }
  })

  it('still drops large rewinds (chunk-merge artifacts)', () => {
    const words = [
      w('one', 100, 100.5), w('two', 101, 101.5),
      w('ghost', 60, 60.5), // 41s rewind: artifact, not an overlapping vocalist
      w('three', 102, 102.5),
    ]
    const clean = sanitizeTranscript(words)
    expect(clean.map((x) => x.word)).toEqual(['one', 'two', 'three'])
  })
})
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts`
Expected: the new "keeps a second interleaved stream" test FAILS ('face' dropped); the "large rewinds" test may already pass.

- [ ] **Step 3: Implement the tolerance**

In `src/ai-pipeline/aligner.ts`:

```ts
// A second vocalist singing over the first produces an interleaved word stream
// whose timestamps rewind by a phrase (~1-3s). Those are real lyrics — keep
// them and sort at the end. Rewinds beyond this are chunk-merge artifacts.
const BACKWARD_TOLERANCE_S = 3
```

Change `pushSanitizedWord` (line ~65):

```ts
function pushSanitizedWord(kept: TranscriptWord[], w: TranscriptWord): void {
  const prev = kept[kept.length - 1]
  if (prev && w.startTime < prev.startTime - BACKWARD_TOLERANCE_S) return
  kept.push(w)
}
```

Change the backwards-drop inside `sanitizeTranscript` (line ~122) the same way:

```ts
    // Large rewinds are chunk-merge artifacts; small ones are an overlapping
    // second vocalist and are kept (sorted below).
    const prev = kept[kept.length - 1]
    if (prev && w.startTime < prev.startTime - BACKWARD_TOLERANCE_S) continue
```

And just before `return kept` at the end of `sanitizeTranscript`:

```ts
  // Restore global time order so downstream LCS/window logic sees one
  // monotonic stream even when two vocalists interleave.
  kept.sort((a, b) => a.startTime - b.startTime)
```

- [ ] **Step 4: Run the aligner tests, then everything**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts`
Expected: PASS.

Run: `npx vitest run tests/ai-pipeline/ tests/lyrics/ && npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: all PASS, no scorecard regressions on the clean songs. If veil/akfg regress, previously-dropped artifact words are now surviving: raise the artifact bar by lowering `BACKWARD_TOLERANCE_S` to 2 and re-run before considering anything else.

- [ ] **Step 5: Re-snapshot if stranger improved**

Run: `npx tsx scripts/audit-corpus.mjs`
If stranger rows improved (more matched lines / fewer needs_review), run `npx tsx scripts/audit-corpus.mjs --write-baseline` and include the baseline in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/ai-pipeline/aligner.ts tests/ai-pipeline/aligner.test.ts tests/ai-pipeline/fixtures/corpus-baseline.json
git commit -m "fix(alignment): keep interleaved dual-vocalist streams in sanitizeTranscript"
```

---

### Task 6: Phonetic skeleton for English (C2b core)

**Files:**
- Create: `src/ai-pipeline/phoneticEn.ts`
- Test: `tests/ai-pipeline/phoneticEn.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ai-pipeline/phoneticEn.test.ts
import { describe, it, expect } from 'vitest'
import { phoneticSkeletonEn, phoneticSimilarityEn, findPhoneticAnchorEn } from '../../src/ai-pipeline/phoneticEn'

describe('phoneticSkeletonEn', () => {
  it('maps mishearings of the same phrase to nearby skeletons', () => {
    expect(phoneticSimilarityEn('Stranger than heaven', 'Strange in the heaven')).toBeGreaterThanOrEqual(0.7)
    expect(
      phoneticSimilarityEn('took all my pain and made a weapon', 'So call my pain and made a way boy'),
    ).toBeGreaterThanOrEqual(0.6)
  })
  it('keeps unrelated phrases apart', () => {
    expect(phoneticSimilarityEn('Stranger than heaven', 'walking on the edge of the night')).toBeLessThan(0.55)
    expect(phoneticSimilarityEn('I found a place that I can call home', 'nothing stays buried no names')).toBeLessThan(0.55)
  })
  it('returns 0 for non-Latin input', () => {
    expect(phoneticSimilarityEn('ただただ荒れていく時代に', 'stranger')).toBe(0)
  })
})

describe('findPhoneticAnchorEn', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })
  const words = [
    w('St', 157.7, 158.02), w('range', 158.02, 158.18), w('in', 158.18, 158.62),
    w('the', 158.62, 158.82), w('heaven', 158.82, 159.18),
    w('unrelated', 161, 161.5), w('words', 161.5, 162),
  ]
  it('anchors a line to its phonetically-matching span', () => {
    const anchor = findPhoneticAnchorEn('Stranger than heaven', words, 150, 165)
    expect(anchor).not.toBeNull()
    expect(anchor!.startTime).toBeCloseTo(157.7, 1)
    expect(anchor!.endTime).toBeCloseTo(159.18, 1)
  })
  it('returns null when nothing in the window is close', () => {
    expect(findPhoneticAnchorEn('completely different sentence here', words, 150, 165)).toBeNull()
  })
  it('returns null for short lines (under 3 words) — too easy to false-match', () => {
    expect(findPhoneticAnchorEn('oh yeah', words, 150, 165)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ai-pipeline/phoneticEn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/ai-pipeline/phoneticEn.ts
import type { TranscriptWord } from './aligner'

/** Similarity floor for claiming a phonetic anchor. */
export const PHONETIC_ANCHOR_MIN_SIMILARITY = 0.7

const VOICED_TO_UNVOICED: Record<string, string> = { b: 'p', d: 't', g: 'k', v: 'f', z: 's', j: 'c' }

/**
 * Collapse an English phrase to a consonant skeleton so mishearings of the
 * same sung phrase land near each other: Whisper hears vowels and voicing
 * unreliably in sung audio, but the consonant frame usually survives
 * ("Strange in the heaven" / "Stranger than heaven").
 */
export function phoneticSkeletonEn(text: string): string {
  let s = text.toLowerCase().replace(/[^a-z]+/g, '')
  if (!s) return ''
  s = s
    .replace(/ph/g, 'f')
    .replace(/wh/g, 'w')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
  s = s.replace(/[bdgvzj]/g, (ch) => VOICED_TO_UNVOICED[ch])
  s = s.replace(/[aeiouwhy]+/g, 'a') // vowels + glides collapse to one symbol
  s = s.replace(/(.)\1+/g, '$1') // dedupe repeats
  return s
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    let prevDiag = 0
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(dp[j], dp[j - 1])
      prevDiag = tmp
    }
  }
  return dp[n]
}

/** Dice-style similarity of two phrases' phonetic skeletons, in [0, 1]. */
export function phoneticSimilarityEn(a: string, b: string): number {
  const sa = phoneticSkeletonEn(a)
  const sb = phoneticSkeletonEn(b)
  if (!sa || !sb) return 0
  return (2 * lcsLength(sa, sb)) / (sa.length + sb.length)
}

export interface PhoneticAnchor {
  startTime: number
  endTime: number
  similarity: number
}

/** Max silence allowed inside a candidate span — beyond this it crosses a phrase boundary. */
const MAX_INTERNAL_GAP_S = 2

/**
 * Find the transcript span inside [windowStart, windowEnd] that best matches
 * the line phonetically. Returns null unless similarity clears the floor —
 * this must never invent anchors on clean songs.
 */
export function findPhoneticAnchorEn(
  lineText: string,
  words: TranscriptWord[],
  windowStart: number,
  windowEnd: number,
): PhoneticAnchor | null {
  const lineWords = lineText.match(/[A-Za-z']+/g) ?? []
  if (lineWords.length < 3) return null
  const cand = words.filter(
    (w) => w.startTime >= windowStart && w.endTime <= windowEnd && /[a-z]/i.test(w.word),
  )
  if (cand.length === 0) return null
  const minLen = Math.max(2, Math.floor(lineWords.length * 0.6))
  const maxLen = Math.ceil(lineWords.length * 1.8)
  let best: PhoneticAnchor | null = null
  for (let s = 0; s < cand.length; s++) {
    for (let len = minLen; len <= maxLen && s + len <= cand.length; len++) {
      const span = cand.slice(s, s + len)
      let broken = false
      for (let k = 1; k < span.length; k++) {
        if (span[k].startTime - span[k - 1].endTime > MAX_INTERNAL_GAP_S) { broken = true; break }
      }
      if (broken) continue
      const similarity = phoneticSimilarityEn(lineText, span.map((w) => w.word).join(''))
      if (similarity >= PHONETIC_ANCHOR_MIN_SIMILARITY && (!best || similarity > best.similarity)) {
        best = { startTime: span[0].startTime, endTime: span[span.length - 1].endTime, similarity }
      }
    }
  }
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/phoneticEn.test.ts`
Expected: PASS. If the "took all my pain" pair scores below 0.6, print both skeletons in the test and adjust ONLY the shared-prefix mappings (e.g. add `th→t` before the vowel collapse) — do not lower the assert threshold below what unrelated pairs score plus a 0.1 margin.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/phoneticEn.ts tests/ai-pipeline/phoneticEn.test.ts
git commit -m "feat(alignment): English phonetic skeleton + anchor finder"
```

---

### Task 7: Phonetic anchor recovery tuner (C2b wiring)

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts`
- Test: `tests/ai-pipeline/lineBoundary.phonetic-recovery.test.ts`
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (re-snapshot)

- [ ] **Step 1: Write the failing fixture test**

Reuse the exact `loadWords`/`refineFor` helpers from Task 4's test file (copy them in; the files are read independently).

```ts
// tests/ai-pipeline/lineBoundary.phonetic-recovery.test.ts
// (imports + loadWords + refineFor copied verbatim from lineBoundary.redistribution.test.ts)

// C2b: Whisper mishears sung English ("Strange in the heaven"); the lexical
// LCS fails but the consonant skeleton survives. The recovery tuner must
// re-anchor such lines to their phonetic match.
describe('line boundary: phonetic anchor recovery (EN)', () => {
  const dir = join(here, 'fixtures/stranger-than-heaven')
  it('stranger word-mode: final "Stranger than heaven" chorus lines anchor near their sung spans', { timeout: 30_000 }, () => {
    const { lineTexts, refined } = refineFor(join(dir, 'lyrics.txt'), join(dir, 'transcript.word.json'))
    // Line 51 ("Stranger than heaven") already anchors at ~157.7 lexically; the
    // one before the bridge (line 47) was piled up at ~153.9 pre-phonetics.
    // After recovery, every occurrence must start within its sung region
    // (validated: the transcript's phonetic matches sit at 157.7-159.2).
    const idx = lineTexts.flatMap((t, i) => (t === 'Stranger than heaven' ? [i] : []))
    expect(idx.length).toBeGreaterThanOrEqual(2)
    // No two occurrences may share the same window (each claims its own span).
    const starts = idx.map((i) => refined.lines[i].startTime)
    for (let k = 1; k < starts.length; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1] + 1)
  })
})
```

Note to implementer: before finalizing assertions, run Task 4's dump (`/private/tmp/...scratchpad/dump-stranger.mjs` pattern or re-derive with `refineFor` + console.log) to pick 1–2 concrete lines that are currently mis-placed and phonetically recoverable, and pin their post-recovery starts within ±1s. The test above is the minimum shape; concrete pinned lines are better.

- [ ] **Step 2: Run to verify it fails (or document why it passes)**

Run: `npx vitest run tests/ai-pipeline/lineBoundary.phonetic-recovery.test.ts`
Expected: FAIL on current placements. If it passes already, strengthen with the pinned-line assertions from the note above until it captures a real current defect.

- [ ] **Step 3: Implement the tuner**

In `src/lyrics/phraseAlignment.ts`, import:

```ts
import { findPhoneticAnchorEn } from '../ai-pipeline/phoneticEn'
```

Add the tuner function (place it next to `backfillLateStartsToMatchedSpan`):

```ts
/** Latin-script lines Whisper misheard fail the lexical LCS but usually keep
 * their consonant frame. For each still-unanchored Latin line, search the
 * window between its neighbours for the best phonetic-skeleton match and
 * re-time onto it. Threshold-gated (>= PHONETIC_ANCHOR_MIN_SIMILARITY) so
 * clean songs are untouched. Returns the re-timed lines plus a recovered mask
 * (used later to upgrade quality to at most 'approximate'). */
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
    out[i].startTime = anchor.startTime
    out[i].endTime = anchor.endTime
    recovered[i] = true
  }
  // Keep starts monotonic (a recovery may not leapfrog its neighbours).
  enforceLineMonotonicity(out)
  return { lines: out, recovered }
}
```

Wire it in `refineAlignmentWithPhrases`, after `backfillLateStartsToMatchedSpan` and **before** the redistribution pass (recovered anchors shrink degenerate runs):

```ts
const phonetic = recoverLatinLinesByPhoneticAnchor(tunedLines, words, sourceLanguage)
tunedLines = phonetic.lines
const redist = redistributeDegenerateRuns(tunedLines, words, sourceLanguage)
tunedLines = redist.lines
```

And in the quality-upgrade section at the end, before the redistribution upgrade loop:

```ts
// Phonetically-recovered lines sit on real (misheard) audio — approximate.
for (let i = 0; i < tunedLines.length; i++) {
  if (lineAlignmentQuality[i] !== 'needs_review') continue
  if (phonetic.recovered[i]) lineAlignmentQuality[i] = 'approximate'
}
```

- [ ] **Step 4: Run the new test and the full suite**

Run: `npx vitest run tests/ai-pipeline/lineBoundary.phonetic-recovery.test.ts`
Expected: PASS.

Run: `npx vitest run tests/ai-pipeline/ tests/lyrics/ && npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: PASS, no clean-song regressions. The critical check: veil / akfg / guitar-loneliness EN lines must not get falsely re-anchored — if any regress, raise `PHONETIC_ANCHOR_MIN_SIMILARITY` to 0.75 and re-run.

- [ ] **Step 5: Re-snapshot and commit**

```bash
npx tsx scripts/audit-corpus.mjs --write-baseline
npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts
git add src/lyrics/phraseAlignment.ts tests/ai-pipeline/lineBoundary.phonetic-recovery.test.ts tests/ai-pipeline/fixtures/corpus-baseline.json
git commit -m "feat(alignment): phonetic anchor recovery for misheard English lines"
```

---

### Task 8: Offline transcription tool with auto language (C3 experiment prep)

**Files:**
- Create: `scripts/transcribe-file.mjs`
- Modify: `scripts/lib/nodeWhisper.mjs` (support `language: 'auto'`)

- [ ] **Step 1: Support auto-detection in nodeWhisper**

In `scripts/lib/nodeWhisper.mjs`, change the `language` option handling inside `transcribeAudio`:

```js
  const lang = options.language ?? 'japanese'
  return asr(resampled, {
    return_timestamps: useWordTimestamps ? 'word' : true,
    // 'auto' → omit the language token so Whisper detects per 30s chunk
    // (mixed JA/EN songs decode each section in its own language).
    language: lang === 'auto' ? null : lang,
    ...
```

(Keep everything else in the call identical.)

- [ ] **Step 2: Write the CLI script**

```js
// scripts/transcribe-file.mjs
/**
 * Transcribe an audio file with the app's Whisper model, from Node.
 *
 * Usage:
 *   npx tsx scripts/transcribe-file.mjs <audio.mp3> [--language auto|japanese|english] \
 *     [--mode word|segment] [--out path.json]
 *
 * Output: { chunks: [{ text, timestamp: [start, end] }] } — the fixture format
 * accepted by scripts/audit-corpus.mjs and the tests' loadWords helpers.
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag, dflt) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

async function main() {
  const input = process.argv[2]
  if (!input || input.startsWith('--')) {
    console.error('Usage: npx tsx scripts/transcribe-file.mjs <audio.mp3> [--language auto|japanese|english] [--mode word|segment] [--out path.json]')
    process.exit(1)
  }
  const language = argValue('--language', 'japanese')
  const mode = argValue('--mode', 'word')
  const out = argValue('--out', `${input}.${mode}.${language}.json`)

  const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
  const { transcribeAudio } = await import(pathToFileURL(join(root, 'scripts/lib/nodeWhisper.mjs')).href)

  console.log(`decoding ${input}...`)
  const { data, sampleRate } = await decodeMp3ToMono(input)
  console.log(`transcribing (${mode} timestamps, language=${language})...`)
  const result = await transcribeAudio(data, sampleRate, {
    language,
    timestampMode: mode,
    onProgress: (p) => process.stdout.write(`\r  ${p}%`),
  })
  process.stdout.write('\n')
  const chunks = (result.chunks ?? []).map((c) => ({ text: c.text, timestamp: c.timestamp }))
  writeFileSync(out, JSON.stringify({ chunks }, null, 1))
  console.log(`wrote ${chunks.length} chunks -> ${out}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 3: Smoke-test on a short run**

Run: `npx tsx scripts/transcribe-file.mjs ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 --language japanese --mode segment --out /tmp/stranger-smoke.json`
Expected: completes (several minutes — whisper-small on CPU), writes a `{chunks: [...]}` JSON. Spot-check that chunks have text and finite timestamps. (This verifies the plumbing with the KNOWN language before the experiment varies it.)

- [ ] **Step 4: Commit**

```bash
git add scripts/transcribe-file.mjs scripts/lib/nodeWhisper.mjs
git commit -m "feat(scripts): offline transcribe-file tool with auto language detection"
```

---

### Task 9: Mixed-language transcription experiment (C3 decision gate)

**Files:**
- Create: `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.autolang.json`
- Create: `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.autolang.json`
- Modify: `tests/ai-pipeline/fixtures/corpus.json` (add the two variant songs)
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (re-snapshot)

- [ ] **Step 1: Generate the auto-language transcripts**

```bash
npx tsx scripts/transcribe-file.mjs ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 \
  --language auto --mode word \
  --out tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.autolang.json
npx tsx scripts/transcribe-file.mjs ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 \
  --language auto --mode segment \
  --out tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.autolang.json
```

Expected: two fixture files. Eyeball the word one: the English chorus regions (e.g. ~25–40s, ~100–130s) should read as recognizably better English than the current `transcript.word.json` ("Tore down the gates" instead of "Dream and a gaze"). If the JA sections turned to garbage instead (auto-detect flipping wrong), the experiment FAILS — record that in the findings doc and skip to Task 11, leaving Task 10 undone.

- [ ] **Step 2: Add the corpus variants**

In `tests/ai-pipeline/fixtures/corpus.json`, after the existing stranger entries:

```json
    {
      "name": "stranger-than-heaven-word-autolang",
      "lang": "ja",
      "lyrics": "stranger-than-heaven/lyrics.txt",
      "transcript": "stranger-than-heaven/transcript.word.autolang.json"
    },
    {
      "name": "stranger-than-heaven-segment-autolang",
      "lang": "ja",
      "lyrics": "stranger-than-heaven/lyrics.txt",
      "transcript": "stranger-than-heaven/transcript.segment.autolang.json"
    },
```

- [ ] **Step 3: Compare scorecards (the decision gate)**

Run: `npx tsx scripts/audit-corpus.mjs`
Compare the `-autolang` rows against the original stranger rows on: `align_needs_review`, `align_pileup`, `align_compressed`, `bnd_measured` (higher = more lines anchored = better), `bnd_gap_p50_p2`.

**Decision:** autolang WINS if `align_needs_review` drops by ≥25% AND `bnd_measured` does not drop. Record the verdict + numbers in the commit message. If it wins → do Task 10. If not → skip Task 10, note the result in Task 11's docs.

- [ ] **Step 4: Snapshot and commit**

```bash
npx tsx scripts/audit-corpus.mjs --write-baseline
npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/corpus-pairing.test.ts
git add tests/ai-pipeline/fixtures/
git commit -m "test(corpus): stranger-than-heaven auto-language transcript variants + verdict"
```

(If `corpus-pairing.test.ts` fails on an embedding-cache miss for the new rows, run `npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache` and include the cache file.)

---

### Task 10: Wire mixed-language auto-detection into the app (only if Task 9 wins)

**Files:**
- Modify: `src/ai-pipeline/whisperLanguage.ts`
- Modify: `src/ai-pipeline/whisper.worker.ts` (transcribe payload, ~line 56 and ~line 84)
- Modify: `src/ai-pipeline/whisperTranscriber.ts` (`transcribeAudio` options, ~line 123, and worker postMessage, ~line 200)
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx` (transcribeAudio call, ~line 181)
- Test: `tests/ai-pipeline/whisperLanguage.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `tests/ai-pipeline/whisperLanguage.test.ts` (match existing import style):

```ts
describe('isMixedLanguageSheet', () => {
  it('true when the sheet has substantial lines in both scripts', () => {
    const lines = [
      'ただただ荒れていく時代に', '過去の輝きに価値はない', '心の形を作る',
      'I found a place where I am not alone', 'Stranger than heaven', 'Back streets walking on the edge',
    ]
    expect(isMixedLanguageSheet(lines)).toBe(true)
  })
  it('false for a JA sheet with an occasional English word', () => {
    const lines = ['ただただ荒れていく時代に', '過去の輝きに価値はない', 'oh yeah', '心の形を作る', '手はいつも汚れだらけ']
    expect(isMixedLanguageSheet(lines)).toBe(false)
  })
  it('false for a pure EN sheet', () => {
    expect(isMixedLanguageSheet(['hello world today', 'another line of text', 'and one more here'])).toBe(false)
  })
})
```

Run: `npx vitest run tests/ai-pipeline/whisperLanguage.test.ts` — expected FAIL (function missing).

- [ ] **Step 2: Implement detection**

In `src/ai-pipeline/whisperLanguage.ts`:

```ts
const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** A sheet is mixed-language when it has at least 3 substantial lines in each
 * script — one-off English hooks ("oh yeah") don't count. Forcing a single
 * Whisper language on such songs garbles the other language's sections. */
export function isMixedLanguageSheet(lineTexts: string[]): boolean {
  let ja = 0
  let latin = 0
  for (const t of lineTexts) {
    if (JA_SCRIPT_RE.test(t)) ja++
    else if ((t.match(/[A-Za-z']+/g) ?? []).length >= 3) latin++
  }
  return ja >= 3 && latin >= 3
}
```

Run the test again — expected PASS.

- [ ] **Step 3: Plumb an `autoLanguage` flag through to the worker**

`src/ai-pipeline/whisperTranscriber.ts`: add `autoLanguage?: boolean` to the `transcribeAudio` options interface (next to `language`), and include it in the worker post:

```ts
      payload: {
        audioData,
        sampleRate,
        language: options?.language,
        autoLanguage: options?.autoLanguage ?? false,
        timestampMode: options?.timestampMode ?? 'word',
      },
```

`src/ai-pipeline/whisper.worker.ts`: destructure `autoLanguage` from the payload (extend the type at ~line 56) and change the asr call's language line (~line 84):

```ts
        language: autoLanguage ? null : whisperLanguageFor(language),
```

`src/ai-pipeline/AutoAlignFlow.tsx` (~line 181): compute the flag from the sheet and pass it:

```ts
      const transcriptResult = await transcribeAudio(audioData, sampleRate, {
        language: song.lyrics.sourceLanguage,
        autoLanguage: isMixedLanguageSheet(
          song.lyrics.lines.map((l) => l.original || l.translation),
        ),
        ...
```

(Verify the lines field name on the `song.lyrics` object in AutoAlignFlow — grep for how line texts are read elsewhere in that file, e.g. the `refineAlignmentWithPhrases` call at ~line 238, and reuse the same accessor.)

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run tests/ai-pipeline/`
Expected: PASS (worker plumbing is exercised by `whisperTranscriber.test.ts` mocks; if its payload assertions fail, extend the expected payload with `autoLanguage: false`).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/whisperLanguage.ts src/ai-pipeline/whisper.worker.ts src/ai-pipeline/whisperTranscriber.ts src/ai-pipeline/AutoAlignFlow.tsx tests/ai-pipeline/whisperLanguage.test.ts
git commit -m "feat(transcription): per-chunk language auto-detect for mixed-language sheets"
```

---

### Task 11: Final verification, docs, and memory

**Files:**
- Modify: `docs/superpowers/2026-07-line-boundary-findings.md` (append a 2026-07-09 section)
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (final snapshot)

- [ ] **Step 1: Full suite + scorecard**

```bash
npx vitest run tests/
npx tsx scripts/audit-corpus.mjs --check-baseline
```

Expected: all PASS. Fix anything that fails before proceeding.

- [ ] **Step 2: Final baseline + before/after table**

Run `npx tsx scripts/audit-corpus.mjs`, then `--write-baseline`. Capture the before/after for the stranger rows (from Task 2's commit message vs now) into the findings doc:

Append to `docs/superpowers/2026-07-line-boundary-findings.md` a `## 2026-07-09 — messy-audio robustness round` section listing: the three new passes (redistribution, interleaved-stream tolerance, phonetic recovery), the C3 experiment verdict with numbers, and the before/after scorecard rows for stranger-than-heaven.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-07-line-boundary-findings.md tests/ai-pipeline/fixtures/corpus-baseline.json
git commit -m "docs: messy-audio robustness findings + final corpus baseline"
```

- [ ] **Step 4: Update memory**

Update `~/.claude/projects/-Users-ninjaruss-Documents-GitHub-utasync/memory/line-boundary-accuracy-status.md` with a round-3 section: what shipped, the C3 verdict, and any residual carve-outs. Reconcile the "alternate take" claim: the July finding attributed stranger's EN garble to an alternate take; this round showed forced-JA decoding was a major contributor — state whichever the C3 experiment proved.
