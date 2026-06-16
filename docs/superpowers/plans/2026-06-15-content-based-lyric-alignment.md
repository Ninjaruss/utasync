# Content-Based Lyric Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Auto-Align match Whisper transcript content to lyric lines (real-timestamp anchoring) instead of distributing them proportionally, falling back to the existing proportional method and warning the user when the match is weak.

**Architecture:** A new pure module `contentAligner.ts` normalizes lyric and transcript text to comparable character streams, finds a monotonic match via LCS, anchors each lyric line to its earliest matched real timestamp, and interpolates the rest. A thin `alignLyrics` orchestrator in `aligner.ts` runs content alignment first and falls back to the existing `alignTranscriptToLines` when content coverage is low. `AutoAlignFlow` consumes the orchestrator, persists a confidence value, and warns on fallback. The existing `sanitizeTranscript`, `weightOf`, and `alignTranscriptToLines` are unchanged and become shared/fallback pieces.

**Tech Stack:** TypeScript, Vitest, React (Vite). No new dependencies.

---

## Background the engineer needs

- A "transcript word" is `{ word: string; startTime: number; endTime: number }`
  (`TranscriptWord` in `src/ai-pipeline/aligner.ts`). Whisper emits ~1 token per
  Japanese character but ~1 token per English word.
- A `TimedLine` (`src/core/types/index.ts`) is
  `{ startTime, endTime, original, translation, ... }`. Alignment only sets
  `startTime`/`endTime`; `original`/`translation` come from `existingLines` when
  provided, else from `lineTexts`.
- The active-line highlighter keys off `startTime` only
  (`src/lyrics/LyricsStore.ts` `binarySearchLine`). Getting `startTime` right is
  what matters.
- Existing exports in `aligner.ts`: `sanitizeTranscript(words)`,
  `alignTranscriptToLines(lineTexts, words, existingLines?, sourceLanguage='ja')`,
  interface `TranscriptWord`. Internal helpers: `JA_CHARS` regex,
  `countMatches`, `latinWordCount`, `weightOf(text, sourceLanguage)`.
- Tests run with `npx vitest run <path>`. Typecheck with
  `npx tsc -p tsconfig.app.json --noEmit`. Lint with `npx eslint <paths>`.
- Benchmark fixtures already exist:
  - `tests/ai-pipeline/fixtures/my-eyes-only.transcript.json` — a JSON array of
    240 `TranscriptWord` objects.
  - `tests/ai-pipeline/fixtures/my-eyes-only.lyrics.txt` — 40 lyric lines, one
    per line.

## File structure

- **Create** `src/ai-pipeline/contentAligner.ts` — normalization, LCS matching,
  anchoring, robustify, interpolation. Exports `alignByContent` and (for unit
  testing) `normalizeForMatch`.
- **Modify** `src/ai-pipeline/aligner.ts` — add `alignLyrics` orchestrator and a
  `CONTENT_CONFIDENCE_THRESHOLD` constant. Export the existing `weightOf` so the
  content module reuses it (rename to exported or pass it in — this plan exports
  a small `lineWeight` helper).
- **Modify** `src/core/types/index.ts` — add optional
  `LyricsData.alignmentConfidence?: number`.
- **Modify** `src/ai-pipeline/AutoAlignFlow.tsx` — call `alignLyrics`, persist
  confidence, warn on fallback.
- **Create** `tests/ai-pipeline/contentAligner.test.ts` — unit tests.
- **Create** `tests/ai-pipeline/alignment-benchmark.test.ts` — real-data MAE
  regression.

---

### Task 1: Export a shared line-weight helper from `aligner.ts`

The content module's interpolation reuses the proportional method's token
weight. Expose it without duplicating logic.

**Files:**
- Modify: `src/ai-pipeline/aligner.ts`
- Test: `tests/ai-pipeline/aligner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ai-pipeline/aligner.test.ts` (top-level, new describe):

```ts
import { lineWeight } from '../../src/ai-pipeline/aligner'

describe('lineWeight', () => {
  it('counts Japanese by character and English by word', () => {
    expect(lineWeight('青空に溶けて', 'ja')).toBe(6)            // 6 kana/kanji
    expect(lineWeight('You always make me so happy', 'ja')).toBe(6) // 6 words
    expect(lineWeight('青空に溶けて', 'ja')).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts -t lineWeight`
Expected: FAIL — `lineWeight` is not exported.

- [ ] **Step 3: Implement**

In `src/ai-pipeline/aligner.ts`, rename the private `weightOf` to an exported
`lineWeight` (keep identical body) and update its internal call site:

```ts
// was: function weightOf(text: string, sourceLanguage: Language): number {
export function lineWeight(text: string, sourceLanguage: Language): number {
  if (sourceLanguage === 'ja') {
    const ja = countMatches(text, JA_CHARS)
    if (ja > 0) return ja
    return latinWordCount(text)
  }
  const words = latinWordCount(text)
  if (words > 0) return words
  const ja = countMatches(text, JA_CHARS)
  if (ja > 0) return ja
  return text.replace(/\s+/g, '').length
}
```

Then in `alignTranscriptToLines`, change the weights line:

```ts
const weights = lineTexts.map((t) => Math.max(1, lineWeight(t, sourceLanguage)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts`
Expected: PASS (all existing aligner tests + the new `lineWeight` test).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/aligner.ts tests/ai-pipeline/aligner.test.ts
git commit -m "refactor: export lineWeight helper from aligner"
```

---

### Task 2: Normalization helper in `contentAligner.ts`

**Files:**
- Create: `src/ai-pipeline/contentAligner.ts`
- Test: `tests/ai-pipeline/contentAligner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-pipeline/contentAligner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeForMatch } from '../../src/ai-pipeline/contentAligner'

describe('normalizeForMatch', () => {
  it('keeps lowercase latin and Japanese, drops spaces/punctuation', () => {
    expect(normalizeForMatch('You always make me')).toBe('youalwaysmakeme')
    expect(normalizeForMatch('「どうした？」なんて')).toBe('どうしたなんて')
    expect(normalizeForMatch('I promise, for my eyes only!')).toBe('ipromiseformyeyesonly')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts -t normalizeForMatch`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement**

Create `src/ai-pipeline/contentAligner.ts`:

```ts
import type { Language, TimedLine } from '../core/types'
import { lineWeight, type TranscriptWord } from './aligner'

// Characters worth matching on: lowercase Latin letters and Japanese scripts
// (kana + prolonged mark + kanji blocks). Everything else (spaces, punctuation,
// full-width symbols) is dropped so it can't block a match.
const MATCH_CHAR = /[a-z぀-ヿー㐀-鿿豈-﫿]/

export function normalizeForMatch(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) if (MATCH_CHAR.test(ch)) out += ch
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts -t normalizeForMatch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/contentAligner.ts tests/ai-pipeline/contentAligner.test.ts
git commit -m "feat: add normalizeForMatch for content alignment"
```

---

### Task 3: `alignByContent` — exact-match anchoring

Build the char streams, LCS match, per-line earliest anchor, interpolate. This
task targets the clean case; robustify (repeats) comes in Task 4.

**Files:**
- Modify: `src/ai-pipeline/contentAligner.ts`
- Test: `tests/ai-pipeline/contentAligner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ai-pipeline/contentAligner.test.ts`:

```ts
import { alignByContent } from '../../src/ai-pipeline/contentAligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('alignByContent (exact match)', () => {
  it('anchors each line to the real timestamp of its matched words', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あ', startTime: 1, endTime: 1.4 },
      { word: 'お', startTime: 1.4, endTime: 1.8 },
      { word: 'ぞ', startTime: 1.8, endTime: 2.2 },
      { word: 'ら', startTime: 2.2, endTime: 2.6 },
      { word: 'ゆ', startTime: 10, endTime: 10.4 },
      { word: 'き', startTime: 10.4, endTime: 10.8 },
      { word: 'が', startTime: 10.8, endTime: 11.2 },
      { word: 'ふ', startTime: 11.2, endTime: 11.6 },
      { word: 'る', startTime: 11.6, endTime: 12 },
    ]
    const { lines: out, confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(1)
    expect(out[0].startTime).toBeLessThan(2)
    expect(out[1].startTime).toBeGreaterThanOrEqual(10)
    expect(out[1].startTime).toBeLessThan(11)
    expect(confidence).toBeGreaterThan(0.9)
  })

  it('reports low confidence when nothing matches', () => {
    const lines = ['あおぞら']
    const words: TranscriptWord[] = [{ word: 'zzz', startTime: 1, endTime: 2 }]
    const { confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(confidence).toBeLessThan(0.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts -t "exact match"`
Expected: FAIL — `alignByContent` not exported.

- [ ] **Step 3: Implement**

Append to `src/ai-pipeline/contentAligner.ts`:

```ts
interface LyricChar { ch: string; line: number }
interface TransChar { ch: string; time: number }

function buildLyricChars(lineTexts: string[]): LyricChar[] {
  const out: LyricChar[] = []
  lineTexts.forEach((line, li) => {
    for (const ch of normalizeForMatch(line)) out.push({ ch, line: li })
  })
  return out
}

function buildTransChars(words: TranscriptWord[]): TransChar[] {
  const out: TransChar[] = []
  for (const w of words) {
    const n = normalizeForMatch(w.word)
    const k = Math.max(1, n.length)
    let j = 0
    for (const ch of n) {
      out.push({ ch, time: w.startTime + (w.endTime - w.startTime) * ((j + 0.5) / k) })
      j++
    }
  }
  return out
}

// Longest common subsequence over the two char streams. Returns, for each lyric
// char index, the matched transcript time or -1 (monotonic by construction).
function lcsMatchTimes(A: LyricChar[], B: TransChar[]): Float64Array {
  const m = A.length, n = B.length
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    const row = dp[i], prev = dp[i - 1]
    for (let j = 1; j <= n; j++) {
      row[j] = A[i - 1].ch === B[j - 1].ch ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
  }
  const matchTime = new Float64Array(m).fill(-1)
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (A[i - 1].ch === B[j - 1].ch) { matchTime[i - 1] = B[j - 1].time; i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return matchTime
}

// Earliest matched time per line; NaN where a line had no matched char.
function anchorsByLine(A: LyricChar[], matchTime: Float64Array, lineCount: number): Float64Array {
  const anchors = new Float64Array(lineCount).fill(NaN)
  for (let idx = 0; idx < A.length; idx++) {
    const mt = matchTime[idx]
    if (mt < 0) continue
    const li = A[idx].line
    if (Number.isNaN(anchors[li]) || mt < anchors[li]) anchors[li] = mt
  }
  return anchors
}

// Fill NaN line-anchors by interpolating between known neighbours, weighted by
// each line's token weight (long lines take proportionally longer).
function interpolateAnchors(
  anchors: Float64Array,
  lineTexts: string[],
  sourceLanguage: Language,
  lastTime: number,
): number[] {
  const n = anchors.length
  const w = lineTexts.map((t) => Math.max(1, lineWeight(t, sourceLanguage)))
  const out = Array.from(anchors)
  // Leading run with no anchor: scale up from 0 to the first known anchor.
  let first = 0
  while (first < n && Number.isNaN(out[first])) first++
  if (first === n) return out.map((_, i) => (i / Math.max(1, n)) * lastTime) // nothing matched
  for (let i = 0; i < first; i++) {
    const num = w.slice(0, i).reduce((a, b) => a + b, 0)
    const den = w.slice(0, first).reduce((a, b) => a + b, 0) || 1
    out[i] = out[first] * (num / den)
  }
  // Middle/trailing gaps. For an unanchored run (l..r-1) between known anchors
  // out[l-1] and out[r], place each line by its cumulative token weight so long
  // lines occupy proportionally more of the interval. A trailing run (no right
  // anchor) holds the last known time.
  let l = first
  while (l < n) {
    if (!Number.isNaN(out[l])) { l++; continue }
    let r = l
    while (r < n && Number.isNaN(out[r])) r++
    const left = out[l - 1]
    if (r < n) {
      const right = out[r]
      const total = w.slice(l, r + 1).reduce((a, b) => a + b, 0) || 1
      let acc = 0
      for (let k = l; k < r; k++) { acc += w[k]; out[k] = left + (right - left) * (acc / total) }
    } else {
      for (let k = l; k < n; k++) out[k] = left
    }
    l = r
  }
  return out
}

export function alignByContent(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines: TimedLine[] | undefined,
  sourceLanguage: Language,
): { lines: TimedLine[]; confidence: number } {
  const lineCount = lineTexts.length
  const buildLine = (li: number, startTime: number, endTime: number): TimedLine => ({
    startTime,
    endTime,
    original: existingLines?.[li]?.original ?? lineTexts[li],
    translation: existingLines?.[li]?.translation ?? lineTexts[li],
  })

  const A = buildLyricChars(lineTexts)
  const B = buildTransChars(words)
  if (A.length === 0 || B.length === 0 || lineCount === 0) {
    return { lines: lineTexts.map((_, li) => buildLine(li, 0, 0)), confidence: 0 }
  }

  const matchTime = lcsMatchTimes(A, B)
  const matched = matchTime.reduce((acc, t) => acc + (t >= 0 ? 1 : 0), 0)
  const confidence = matched / A.length

  const anchors = anchorsByLine(A, matchTime, lineCount)
  const lastTime = B[B.length - 1].time
  const starts = interpolateAnchors(anchors, lineTexts, sourceLanguage, lastTime)

  // Monotonic guard.
  for (let li = 1; li < starts.length; li++) if (starts[li] < starts[li - 1]) starts[li] = starts[li - 1]

  const lines = starts.map((s, li) => buildLine(li, s, li + 1 < starts.length ? Math.max(s, starts[li + 1]) : Math.max(s, lastTime)))
  // Clamp each line's end to the next line's start (rest at gaps); last line holds to lastTime.
  for (let li = 0; li < lines.length - 1; li++) lines[li].endTime = Math.max(lines[li].startTime, starts[li + 1])
  return { lines, confidence }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts`
Expected: PASS (normalize + exact-match + low-confidence tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/ai-pipeline/contentAligner.ts tests/ai-pipeline/contentAligner.test.ts
git commit -m "feat: content-based alignment via LCS char matching"
```

---

### Task 4: Robustify anchors for repeated lines

LCS can match a repeated refrain line's chars to an earlier identical copy,
producing an anchor that is too early. Drop anchors that decrease vs. the
previous kept anchor before interpolation (those lines then interpolate from
neighbours).

**Files:**
- Modify: `src/ai-pipeline/contentAligner.ts`
- Test: `tests/ai-pipeline/contentAligner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ai-pipeline/contentAligner.test.ts`:

```ts
describe('alignByContent (repeated lines)', () => {
  it('does not place a later repeated line earlier than a previous line', () => {
    // "ねえ" appears 3 times; the transcript has them at 5s, 50s, 90s.
    const lines = ['ねえ', 'そら', 'ねえ', 'うみ', 'ねえ']
    const words: TranscriptWord[] = [
      { word: 'ねえ', startTime: 5, endTime: 6 },
      { word: 'そら', startTime: 20, endTime: 21 },
      { word: 'ねえ', startTime: 50, endTime: 51 },
      { word: 'うみ', startTime: 70, endTime: 71 },
      { word: 'ねえ', startTime: 90, endTime: 91 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
    expect(out[4].startTime).toBeGreaterThan(out[3].startTime)
  })
})
```

- [ ] **Step 2: Run test to verify it fails or is brittle**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts -t "repeated lines"`
Expected: Likely PASS already via the monotonic guard, OR FAIL if a backward
anchor distorts an intermediate line. Either way, add the explicit robustify so
backward anchors interpolate instead of being clamped flat.

- [ ] **Step 3: Implement**

In `alignByContent`, insert a robustify pass between `anchorsByLine` and
`interpolateAnchors`:

```ts
  const anchors = anchorsByLine(A, matchTime, lineCount)
  // Robustify: a later line anchored earlier than an earlier line is a wrong
  // match against a repeated phrase — drop it so it interpolates from neighbours.
  let lastKept = -Infinity
  for (let li = 0; li < anchors.length; li++) {
    if (Number.isNaN(anchors[li])) continue
    if (anchors[li] < lastKept) anchors[li] = NaN
    else lastKept = anchors[li]
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/contentAligner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/contentAligner.ts tests/ai-pipeline/contentAligner.test.ts
git commit -m "feat: drop backward anchors for repeated lyric lines"
```

---

### Task 5: `alignLyrics` orchestrator with fallback

**Files:**
- Modify: `src/ai-pipeline/aligner.ts`
- Test: `tests/ai-pipeline/aligner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ai-pipeline/aligner.test.ts`:

```ts
import { alignLyrics } from '../../src/ai-pipeline/aligner'

describe('alignLyrics', () => {
  it('uses content mode when the transcript matches the lyrics', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あおぞら', startTime: 1, endTime: 2 },
      { word: 'ゆきがふる', startTime: 10, endTime: 11 },
    ]
    const r = alignLyrics(lines, words, undefined, 'ja')
    expect(r.mode).toBe('content')
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.lines[1].startTime).toBeGreaterThanOrEqual(10)
  })

  it('falls back to proportional when nothing matches', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'xxxxx', startTime: 1, endTime: 2 },
      { word: 'yyyyy', startTime: 10, endTime: 11 },
    ]
    const r = alignLyrics(lines, words, undefined, 'ja')
    expect(r.mode).toBe('proportional')
    expect(r.confidence).toBeLessThan(0.5)
    expect(r.lines).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts -t alignLyrics`
Expected: FAIL — `alignLyrics` not exported.

- [ ] **Step 3: Implement**

In `src/ai-pipeline/aligner.ts`, add an import and the orchestrator. Place the
import at the top, the constant near the other consts, and the function after
`alignTranscriptToLines`:

```ts
import { alignByContent } from './contentAligner'

export const CONTENT_CONFIDENCE_THRESHOLD = 0.5

export type AlignResult = {
  lines: TimedLine[]
  mode: 'content' | 'proportional'
  confidence: number
}

export function alignLyrics(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines?: TimedLine[],
  sourceLanguage: Language = 'ja',
): AlignResult {
  const clean = sanitizeTranscript(words)
  const content = alignByContent(lineTexts, clean, existingLines, sourceLanguage)
  if (content.confidence >= CONTENT_CONFIDENCE_THRESHOLD) {
    return { lines: content.lines, mode: 'content', confidence: content.confidence }
  }
  const lines = alignTranscriptToLines(lineTexts, clean, existingLines, sourceLanguage)
  return { lines, mode: 'proportional', confidence: content.confidence }
}
```

> Note on double-sanitizing: `alignTranscriptToLines` calls `sanitizeTranscript`
> internally, so passing the already-`clean` words to it sanitizes twice. That is
> safe (sanitizing is idempotent) and keeps both the content and proportional
> paths operating on the same cleaned input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/aligner.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/ai-pipeline/aligner.ts tests/ai-pipeline/aligner.test.ts
git commit -m "feat: alignLyrics orchestrator with content/proportional fallback"
```

---

### Task 6: Real-data benchmark regression test

**Files:**
- Create: `tests/ai-pipeline/alignment-benchmark.test.ts`
- Uses: `tests/ai-pipeline/fixtures/my-eyes-only.transcript.json`,
  `tests/ai-pipeline/fixtures/my-eyes-only.lyrics.txt`

- [ ] **Step 1: Write the test**

Create `tests/ai-pipeline/alignment-benchmark.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignLyrics } from '../../src/ai-pipeline/aligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const here = dirname(fileURLToPath(import.meta.url))
const words: TranscriptWord[] = JSON.parse(
  readFileSync(join(here, 'fixtures/my-eyes-only.transcript.json'), 'utf8'),
)
const lineTexts = readFileSync(join(here, 'fixtures/my-eyes-only.lyrics.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean)

// Ground-truth sung start times (seconds), read off the Whisper word timeline.
const truth = [0.0,4.8,7.6,11.9,14.5,21.3,29.1,33.0,36.2,39.8,43.0,48.7,56.9,61.3,
  64.0,68.3,71.1,75.4,78.2,82.4,85.1,91.9,99.5,103.3,106.7,110.4,113.7,120.0,127.6,
  133.7,136.4,140.6,143.4,147.8,150.5,154.9,157.4,167.0,171.3,178.3]

describe('alignment benchmark (My Eyes Only)', () => {
  it('selects content mode and keeps mean error under 1.0s', () => {
    expect(lineTexts).toHaveLength(truth.length)
    const r = alignLyrics(lineTexts, words, undefined, 'ja')
    expect(r.mode).toBe('content')
    const mae = r.lines.reduce((a, l, i) => a + Math.abs(l.startTime - truth[i]), 0) / truth.length
    expect(mae).toBeLessThan(1.0)
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/ai-pipeline/alignment-benchmark.test.ts`
Expected: PASS (MAE ≈ 0.5s, mode content). If `mode` is not `content`, lower is
not the issue — check the threshold/coverage; coverage on this fixture is high.

- [ ] **Step 3: Commit**

```bash
git add tests/ai-pipeline/alignment-benchmark.test.ts tests/ai-pipeline/fixtures
git commit -m "test: real-data alignment benchmark (<1.0s MAE)"
```

---

### Task 7: Persist confidence on the song type

**Files:**
- Modify: `src/core/types/index.ts:33-38`

- [ ] **Step 1: Add the field**

Change `LyricsData`:

```ts
export interface LyricsData {
  lines: TimedLine[]
  sourceLanguage: Language
  translationLanguage: Language
  alignmentMode: AlignmentMode
  alignmentConfidence?: number
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (optional field, no breakage).

- [ ] **Step 3: Commit**

```bash
git add src/core/types/index.ts
git commit -m "feat: add optional LyricsData.alignmentConfidence"
```

---

### Task 8: Wire `AutoAlignFlow` to `alignLyrics` + fallback warning

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx:4` (import),
  `:91-92` (align call), `:140` (done UI)

- [ ] **Step 1: Update the import**

Change line 4:

```ts
import { alignLyrics, type TranscriptWord } from './aligner'
```

- [ ] **Step 2: Use the orchestrator and persist confidence**

Replace the two lines at `:91-92`:

```ts
      const { lines: aligned, mode, confidence } = alignLyrics(
        lineTexts, words, song.lyrics.lines, song.lyrics.sourceLanguage,
      )
      const updated: Song = {
        ...song,
        lyrics: { ...song.lyrics, lines: aligned, alignmentMode: 'auto', alignmentConfidence: confidence },
      }
```

- [ ] **Step 3: Track fallback in state and show a warning**

Add state near the other `useState` calls (top of component):

```ts
  const [lowConfidence, setLowConfidence] = useState(false)
```

Set it right before `setStage('done')`:

```ts
      setLowConfidence(mode === 'proportional')
      setStage('done')
```

Replace the done-state line at `:140`:

```tsx
        {stage === 'done' && (
          lowConfidence
            ? <p className="text-yellow-400 text-sm">Alignment is approximate — the audio didn’t closely match these lyrics. Try tap-sync or double-check your lyrics.</p>
            : <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>
        )}
```

- [ ] **Step 4: Typecheck, lint, full test run**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx eslint src/ai-pipeline/contentAligner.ts src/ai-pipeline/aligner.ts src/ai-pipeline/AutoAlignFlow.tsx
npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit -m "feat: auto-align uses content alignment and warns on low-confidence fallback"
```

---

### Task 9: Manual verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Use the preview tooling (`preview_start` with `utasync-dev`) or `npm run dev`.

- [ ] **Step 2: Exercise auto-align**

Upload `My Eyes Only` (or any song), paste the matching lyrics, run Auto-Align.
Confirm: transcribe progress advances, then lines highlight in time with the
vocals (content mode), no low-confidence warning.

- [ ] **Step 3: Exercise the fallback**

Run Auto-Align with deliberately wrong lyrics (paste unrelated text). Confirm the
yellow approximate-alignment warning appears on the done screen.

- [ ] **Step 4: No commit** (verification only).

---

## Self-review notes

- **Spec coverage:** content module (T2–T4), orchestrator + threshold (T5),
  fallback (T5), confidence surfaced (T5/T7/T8), warning (T8), benchmark <1.0s
  (T6), persisted confidence (T7), proportional + sanitize unchanged (used as-is
  in T5). All spec sections map to tasks.
- **Type consistency:** `alignByContent` returns `{ lines, confidence }`;
  `alignLyrics` returns `{ lines, mode, confidence }` (`AlignResult`); flow reads
  `{ lines, mode, confidence }`. `lineWeight(text, sourceLanguage)` used in both
  `aligner.ts` and `contentAligner.ts`. `LyricsData.alignmentConfidence?: number`
  matches the value written in T8.
- **Placeholder note:** Task 3 deliberately shows the interpolation formula twice
  with an explicit instruction to keep only the cumulative-weight loop — follow
  the note; do not ship both loops.
```
