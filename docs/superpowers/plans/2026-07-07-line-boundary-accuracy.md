# Line-Boundary Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and fix lyric lines ending too early/too late in both alignment passes, across an expanded corpus including mixed JP+EN songs (Stranger than Heaven).

**Architecture:** Extend the existing deterministic corpus instrument (`scripts/audit-corpus.mjs` + committed fixtures + baseline CI guard). A new exported helper in `contentAligner.ts` exposes per-line matched transcript spans from the same LCS the aligner uses; a new pure-JS metrics module turns line timings + spans into boundary-defect counts, scored separately for pass 1 (`alignLyrics`) and pass 2 (`refineAlignmentWithPhrases` output). Defects found then get TDD fixes in the tail-tuning functions of `phraseAlignment.ts` / `contentAligner.ts`.

**Tech Stack:** TypeScript (src), plain ESM JS (scripts/lib), vitest, tsx, Whisper via `scripts/lib/nodeWhisper.mjs` (one-time transcript generation only).

**Spec:** `docs/superpowers/specs/2026-07-07-line-boundary-accuracy-design.md`

**Key background for a fresh engineer:**
- `refineAlignmentWithPhrases(sheetRows, words, lang)` ([src/lyrics/phraseAlignment.ts:1408](../../src/lyrics/phraseAlignment.ts)) internally calls `alignLyrics` ([src/ai-pipeline/aligner.ts:283](../../src/ai-pipeline/aligner.ts)) as pass 1, then phrase-projects, validates, and runs ~10 tail/boundary tuning functions. "Per-pass attribution" = score pass 1's `lines` and the final returned `lines` with the same metrics.
- The aligner matches lyrics to transcript via a char-level LCS: `buildLyricChars` / `buildTransChars` / `lcsMatchTimes` (contentAligner.ts:92/100/136, all module-private today). `LcsMatch.matchBIndex` gives the matched transcript char per lyric char; `TransChar` carries per-char `time` (onset) and `endTime`.
- Transcript fixtures are either a word array (`[{word,startTime,endTime}]`) or raw Whisper `{chunks:[{text,timestamp:[s,e]}]}` — both loaders already exist in `audit-corpus.mjs` and `corpus-scorecard.test.ts`. Raw cache files from `scripts/audit-auto-align.mjs` (in `.cache/auto-align-audit/`) are `{chunks}` format and can be copied into fixtures as-is; `sanitizeTranscript` runs inside the pipeline.
- Run any test with `npx vitest run tests/ai-pipeline/<file> --reporter=dot`. Run the scorecard with `npx tsx scripts/audit-corpus.mjs`.

---

### Task 1: `computeLineMatchedSpans` in contentAligner

Expose per-line matched transcript spans (first matched onset, last matched offset, matched/total chars) from the same LCS used by `alignByContent`, filtered to reliable runs (≥2 consecutive lyric chars matched to consecutive transcript chars — same rationale as `MIN_RELIABLE_RUN`, contentAligner.ts:~330).

**Files:**
- Modify: `src/ai-pipeline/contentAligner.ts` (add after `scoreLineAlignment`, ~line 630)
- Test: `tests/ai-pipeline/lineMatchedSpans.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

// Two lines sung back to back. Transcript words carry exact times, so the
// span of each line must snap to its own words' onset/offset.
const words = [
  { word: 'こんにちは', startTime: 10, endTime: 12 },
  { word: '世界', startTime: 12.5, endTime: 13.5 },
  { word: 'さようなら', startTime: 20, endTime: 22 },
  { word: '世界', startTime: 22.5, endTime: 23.5 },
]

describe('computeLineMatchedSpans', () => {
  it('maps each line to the span of its reliably matched transcript chars', () => {
    const spans = computeLineMatchedSpans(['こんにちは世界', 'さようなら世界'], words)
    expect(spans[0]).not.toBeNull()
    expect(spans[1]).not.toBeNull()
    expect(spans[0]!.firstTime).toBeCloseTo(10, 5)
    expect(spans[0]!.lastEndTime).toBeCloseTo(13.5, 5)
    expect(spans[1]!.firstTime).toBeCloseTo(20, 5)
    expect(spans[1]!.lastEndTime).toBeCloseTo(23.5, 5)
    expect(spans[0]!.matchedChars).toBe(7)
    expect(spans[0]!.totalChars).toBe(7)
  })

  it('returns null for a line with no reliable match', () => {
    const spans = computeLineMatchedSpans(['こんにちは', '存在しない歌詞行です'], [words[0]])
    expect(spans[0]).not.toBeNull()
    expect(spans[1]).toBeNull()
  })

  it('returns all nulls on empty transcript', () => {
    expect(computeLineMatchedSpans(['こんにちは'], [])).toEqual([null])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/lineMatchedSpans.test.ts --reporter=dot`
Expected: FAIL — `computeLineMatchedSpans` is not exported.

- [ ] **Step 3: Implement**

Add to `src/ai-pipeline/contentAligner.ts` (after `scoreLineAlignment`; reuses module-private `buildLyricChars`, `buildTransChars`, `lcsMatchTimes`, `normalizeForMatch`, `MIN_RELIABLE_RUN`):

```ts
export interface LineMatchedSpan {
  /** Onset of the line's first reliably matched transcript char. */
  firstTime: number
  /** Offset of the line's last reliably matched transcript char. */
  lastEndTime: number
  matchedChars: number
  totalChars: number
}

/**
 * Per-line matched transcript span from the same char-LCS alignByContent uses.
 * Only runs of MIN_RELIABLE_RUN+ consecutive lyric chars matched to consecutive
 * transcript chars count (same coincidence filter as line anchoring). Null =
 * no reliable match for that line. Pass sanitized words (sanitizeTranscript)
 * for parity with the alignment pipeline.
 */
export function computeLineMatchedSpans(
  lineTexts: string[],
  words: TranscriptWord[],
): Array<LineMatchedSpan | null> {
  const totals = lineTexts.map((t) => normalizeForMatch(t).length)
  const A = buildLyricChars(lineTexts)
  const B = buildTransChars(words)
  const spans: Array<LineMatchedSpan | null> = lineTexts.map(() => null)
  if (A.length === 0 || B.length === 0) return spans
  const match = lcsMatchTimes(A, B)
  let i = 0
  while (i < A.length) {
    if (match.matchBIndex[i] < 0) {
      i++
      continue
    }
    let j = i + 1
    while (
      j < A.length &&
      match.matchBIndex[j] === match.matchBIndex[j - 1] + 1 &&
      A[j].line === A[j - 1].line
    ) j++
    if (j - i >= MIN_RELIABLE_RUN) {
      for (let k = i; k < j; k++) {
        const li = A[k].line
        const s = spans[li] ?? {
          firstTime: Infinity,
          lastEndTime: -Infinity,
          matchedChars: 0,
          totalChars: totals[li],
        }
        s.firstTime = Math.min(s.firstTime, match.matchTime[k])
        s.lastEndTime = Math.max(s.lastEndTime, match.matchEndTime[k])
        s.matchedChars++
        spans[li] = s
      }
    }
    i = j
  }
  return spans
}
```

Note: `TranscriptWord` is already imported in contentAligner.ts via `import type ... from './aligner'` — verify; if not present, add `import type { TranscriptWord } from './aligner'` (check for an existing import first; the file already uses the type in `scoreLineAlignment`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/lineMatchedSpans.test.ts --reporter=dot`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/contentAligner.ts tests/ai-pipeline/lineMatchedSpans.test.ts
git commit -m "feat(align): expose per-line matched transcript spans from LCS"
```

---

### Task 2: Boundary metrics module

Pure function: aligned lines + matched spans + sanitized words → boundary defect counts. Lives in `scripts/lib/` as ESM JS so both the audit script and vitest can import it.

**Files:**
- Create: `scripts/lib/boundaryMetrics.mjs`
- Test: `tests/ai-pipeline/boundaryMetrics.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeBoundaryMetrics } from '../../scripts/lib/boundaryMetrics.mjs'

const span = (firstTime: number, lastEndTime: number) => ({
  firstTime,
  lastEndTime,
  matchedChars: 8,
  totalChars: 10,
})
const words = [
  { word: 'あ', startTime: 10, endTime: 10.5 },
  { word: 'い', startTime: 20, endTime: 20.5 },
  { word: 'ロング', startTime: 30, endTime: 33 },
]

describe('computeBoundaryMetrics', () => {
  it('counts an early end when the line ends >0.35s before its last matched char', () => {
    const lines = [{ startTime: 10, endTime: 11, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [span(10, 12)], words)
    expect(m.earlyEnd).toBe(1)
    expect(m.measured).toBe(1)
  })

  it('counts a late end when a line runs past the next line’s first matched char', () => {
    const lines = [
      { startTime: 10, endTime: 20.4, original: 'x', translation: '' },
      { startTime: 20.4, endTime: 22, original: 'y', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [span(10, 11), span(20, 22)], words)
    expect(m.lateEnd).toBe(1)
  })

  it('counts a mid-word boundary when a line end falls inside a long word', () => {
    const lines = [{ startTime: 29, endTime: 31.5, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [span(29, 31.5)], words)
    expect(m.midWord).toBe(1)
  })

  it('skips unmeasurable lines: null span, low coverage, retargeted occurrence', () => {
    const low = { firstTime: 10, lastEndTime: 12, matchedChars: 2, totalChars: 10 }
    const retargeted = span(100, 110) // span no longer overlaps line window
    const lines = [
      { startTime: 10, endTime: 12, original: 'a', translation: '' },
      { startTime: 13, endTime: 14, original: 'b', translation: '' },
      { startTime: 15, endTime: 16, original: 'c', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [null, low, retargeted], words)
    expect(m.measured).toBe(0)
    expect(m.earlyEnd).toBe(0)
    expect(m.lateEnd).toBe(0)
  })

  it('classifies unmatched lines past the audio end as beyondAudio', () => {
    const lines = [{ startTime: 40, endTime: 41, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [null], words)
    expect(m.beyondAudio).toBe(1)
  })

  it('reports gap percentiles across consecutive measured pairs', () => {
    const lines = [
      { startTime: 10, endTime: 10.5, original: 'a', translation: '' },
      { startTime: 20, endTime: 20.5, original: 'b', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [span(10, 10.5), span(20, 20.5)], words)
    expect(m.gapP50).toBeCloseTo(9.5, 2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/boundaryMetrics.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/boundaryMetrics.mjs`**

```js
/**
 * Boundary-accuracy metrics: do aligned line ends track the sung audio?
 * Inputs: lines (TimedLine[]), spans (LineMatchedSpan|null per line, from
 * computeLineMatchedSpans over SANITIZED words), words (sanitized transcript).
 * Only well-matched lines are scored; a line whose LCS span no longer overlaps
 * its own window (repeat-stanza retarget) is skipped, not penalized.
 */
export const EARLY_END_THRESHOLD_S = 0.35
export const OVERLAP_EPS_S = 0.05
export const MIN_SPAN_COVERAGE = 0.55
// Only a word this long can meaningfully "contain" a line boundary.
const MID_WORD_MIN_DURATION_S = 0.4
const MID_WORD_MARGIN_S = 0.15

function wellMatched(line, span) {
  if (!span || span.totalChars === 0) return false
  if (span.matchedChars / span.totalChars < MIN_SPAN_COVERAGE) return false
  return span.firstTime < line.endTime && span.lastEndTime > line.startTime
}

export function computeBoundaryMetrics(lines, spans, words, opts = {}) {
  const early = opts.earlyEndThresholdS ?? EARLY_END_THRESHOLD_S
  const eps = opts.overlapEpsS ?? OVERLAP_EPS_S
  const lastAudio = words.length ? words[words.length - 1].endTime : 0
  let measured = 0
  let earlyEnd = 0
  let lateEnd = 0
  let midWord = 0
  let beyondAudio = 0
  const gaps = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const span = spans[i]
    if (!wellMatched(line, span)) {
      if (!span && line.startTime >= lastAudio - 1) beyondAudio++
      continue
    }
    measured++
    if (span.lastEndTime - line.endTime > early) earlyEnd++
    for (const w of words) {
      if (w.endTime - w.startTime < MID_WORD_MIN_DURATION_S) continue
      if (
        line.endTime > w.startTime + MID_WORD_MARGIN_S &&
        line.endTime < w.endTime - MID_WORD_MARGIN_S
      ) {
        midWord++
        break
      }
    }
    const next = lines[i + 1]
    const nextSpan = spans[i + 1]
    if (next && wellMatched(next, nextSpan)) {
      if (line.endTime - nextSpan.firstTime > eps && nextSpan.firstTime >= span.firstTime) lateEnd++
      gaps.push(next.startTime - line.endTime)
    }
  }
  gaps.sort((a, b) => a - b)
  const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : 0)
  return {
    measured,
    earlyEnd,
    lateEnd,
    midWord,
    beyondAudio,
    gapP50: Number(pct(0.5).toFixed(2)),
    gapP95: Number(pct(0.95).toFixed(2)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/boundaryMetrics.test.ts --reporter=dot`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/boundaryMetrics.mjs tests/ai-pipeline/boundaryMetrics.test.ts
git commit -m "feat(audit): boundary-accuracy metrics module (early/late line ends)"
```

---

### Task 3: Wire boundary metrics + per-pass attribution into the corpus audit

**Files:**
- Modify: `scripts/audit-corpus.mjs` (imports ~line 54-62; per-song loop ~line 98-149)

- [ ] **Step 1: Add imports inside `main()`** (next to the existing dynamic imports):

```js
  const { alignLyrics, sanitizeTranscript } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href
  )
  const { computeLineMatchedSpans } = await import(
    pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href
  )
  const { computeBoundaryMetrics } = await import(
    pathToFileURL(join(root, 'scripts/lib/boundaryMetrics.mjs')).href
  )
```

- [ ] **Step 2: Compute per-pass boundary metrics in the song loop.** After the existing `const refined = refineAlignmentWithPhrases(...)` line, add:

```js
    // --- boundary metrics, attributed per pass ---
    const sanitized = sanitizeTranscript(words)
    const spans = computeLineMatchedSpans(lineTexts, sanitized)
    const pass1 = alignLyrics(lineTexts, words, sheetRows, song.lang)
    const bnd1 = computeBoundaryMetrics(pass1.lines, spans, sanitized)
    const bnd2 = computeBoundaryMetrics(refined.lines, spans, sanitized)
```

and extend the scorecard row (inside the existing `scorecard[song.name] = { ... }`), after `align_long_dur`:

```js
      bnd_measured: bnd2.measured,
      bnd_early_p1: bnd1.earlyEnd,
      bnd_early_p2: bnd2.earlyEnd,
      bnd_late_p1: bnd1.lateEnd,
      bnd_late_p2: bnd2.lateEnd,
      bnd_midword_p2: bnd2.midWord,
      bnd_beyond_audio: bnd2.beyondAudio,
      bnd_gap_p50_p2: `${bnd2.gapP50}s`,
      bnd_gap_p95_p2: `${bnd2.gapP95}s`,
```

Gap percentiles are emitted as **strings** deliberately: `checkBaseline` only compares numbers, and a gap distribution shifting is informational, not a regression. `bnd_measured` is numeric but note: MORE measured lines is better, yet checkBaseline treats increases as regressions — so emit it as a string too: `bnd_measured: String(bnd2.measured),`. (Final column set: `bnd_measured` string, four early/late counts numeric, `bnd_midword_p2` numeric, `bnd_beyond_audio` numeric, two gap strings.)

- [ ] **Step 3: Run the audit on the existing 4-song corpus**

Run: `npx tsx scripts/audit-corpus.mjs`
Expected: scorecard prints with the new columns; no crash; existing columns unchanged vs `tests/ai-pipeline/fixtures/corpus-baseline.json`. Note the boundary numbers — they are the first real measurement; do NOT write the baseline yet.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-corpus.mjs
git commit -m "feat(audit): per-pass line-boundary columns in corpus scorecard"
```

---

### Task 4: Extend the CI guard test with boundary metrics

`tests/ai-pipeline/corpus-scorecard.test.ts` recomputes alignment metrics per song and asserts them ≤ baseline. Add the boundary counts the same way.

**Files:**
- Modify: `tests/ai-pipeline/corpus-scorecard.test.ts`

- [ ] **Step 1: Add imports**

```ts
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
// @ts-expect-error plain ESM module without types
import { computeBoundaryMetrics } from '../../scripts/lib/boundaryMetrics.mjs'
```

- [ ] **Step 2: Add assertions.** Inside the existing per-song `it(...)` (after the current metric assertions — read the file and mirror its exact pattern of comparing computed metrics against `baseline[song.name]`), compute:

```ts
    const sanitized = sanitizeTranscript(words)
    const spans = computeLineMatchedSpans(lineTexts, sanitized)
    const pass1 = alignLyrics(lineTexts, words, sheetRows, song.lang)
    const bnd1 = computeBoundaryMetrics(pass1.lines, spans, sanitized)
    const bnd2 = computeBoundaryMetrics(refined.lines, spans, sanitized)
    const base = baseline[song.name]
    for (const [key, val] of [
      ['bnd_early_p1', bnd1.earlyEnd],
      ['bnd_early_p2', bnd2.earlyEnd],
      ['bnd_late_p1', bnd1.lateEnd],
      ['bnd_late_p2', bnd2.lateEnd],
      ['bnd_midword_p2', bnd2.midWord],
      ['bnd_beyond_audio', bnd2.beyondAudio],
    ] as const) {
      if (typeof base[key] === 'number') {
        expect(val, `${song.name} ${key} regressed`).toBeLessThanOrEqual(base[key] as number)
      }
    }
```

The `typeof === 'number'` guard means the test passes before the baseline is re-snapshotted (Task 9) and enforces after.

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts --reporter=dot`
Expected: PASS (baseline has no `bnd_*` keys yet, so new assertions are dormant; existing assertions still enforced).

- [ ] **Step 4: Commit**

```bash
git add tests/ai-pipeline/corpus-scorecard.test.ts
git commit -m "test(audit): guard boundary metrics against baseline regressions"
```

---

### Task 5: Generate transcripts for Stranger than Heaven + Guitar Loneliness

One-time real-Whisper runs (minutes each on CPU — use background Bash). Lyrics fixtures are already committed. MP3s (do NOT commit):
- `~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3`
- `~/Downloads/guitar-loneliness-and-blue-planet-128-ytshorts.savetube.me.mp3`

A segment-mode cache for Stranger than Heaven already exists at `.cache/auto-align-audit/STRANGER_THAN_HEAVEN_segment.json` (cache key = name with `\W+` → `_`, so pass the name `STRANGER THAN HEAVEN` to reuse it).

**Files:**
- Create: `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json`
- Create: `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.json`
- Create: `tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json`
- Create: `tests/ai-pipeline/fixtures/guitar-loneliness/transcript.segment.json`

- [ ] **Step 1: Run the four audits** (word + segment per song; word mode has no `--segment` flag):

```bash
npx tsx scripts/audit-auto-align.mjs "STRANGER THAN HEAVEN" ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt
npx tsx scripts/audit-auto-align.mjs "STRANGER THAN HEAVEN" ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt --segment
npx tsx scripts/audit-auto-align.mjs "GUITAR LONELINESS" ~/Downloads/guitar-loneliness-and-blue-planet-128-ytshorts.savetube.me.mp3 tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt
npx tsx scripts/audit-auto-align.mjs "GUITAR LONELINESS" ~/Downloads/guitar-loneliness-and-blue-planet-128-ytshorts.savetube.me.mp3 tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt --segment
```

Expected: each prints per-line timings and caches the transcript. Skim the output — if the Stranger than Heaven audio is a trailer cut, later lyric lines will show as unmatched; that's expected (`bnd_beyond_audio` exists for this).

- [ ] **Step 2: Promote cache files to fixtures**

```bash
cp .cache/auto-align-audit/STRANGER_THAN_HEAVEN_word.json tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json
cp .cache/auto-align-audit/STRANGER_THAN_HEAVEN_segment.json tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.json
cp .cache/auto-align-audit/GUITAR_LONELINESS_word.json tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json
cp .cache/auto-align-audit/GUITAR_LONELINESS_segment.json tests/ai-pipeline/fixtures/guitar-loneliness/transcript.segment.json
```

(If the word-mode cache landed without the `_word` suffix — older script versions cached word mode as `<name>.json` — copy that file instead; check `ls .cache/auto-align-audit/`.)

- [ ] **Step 3: Commit**

```bash
git add tests/ai-pipeline/fixtures/stranger-than-heaven tests/ai-pipeline/fixtures/guitar-loneliness
git commit -m "test(fixtures): Whisper transcripts for stranger-than-heaven and guitar-loneliness"
```

---

### Task 6: Promote Rock'n'Roll (user version) fixtures + register all new corpus entries

Cached transcripts for the user's Rock'n'Roll upload already exist; the matching lyrics are the committed `tests/ai-pipeline/fixtures/akfg-user-ja.txt`.

**Files:**
- Create: `tests/ai-pipeline/fixtures/akfg-user/transcript.word.json` (from `.cache/auto-align-audit/UserRockRoll_word.json`)
- Create: `tests/ai-pipeline/fixtures/akfg-user/transcript.segment.json` (from `.cache/auto-align-audit/UserRockRoll_segment.json`)
- Modify: `tests/ai-pipeline/fixtures/corpus.json`

- [ ] **Step 1: Copy transcripts**

```bash
mkdir -p tests/ai-pipeline/fixtures/akfg-user
cp .cache/auto-align-audit/UserRockRoll_word.json tests/ai-pipeline/fixtures/akfg-user/transcript.word.json
cp .cache/auto-align-audit/UserRockRoll_segment.json tests/ai-pipeline/fixtures/akfg-user/transcript.segment.json
```

- [ ] **Step 2: Add six entries to `corpus.json`** (append inside `"songs": [...]`):

```json
    {
      "name": "stranger-than-heaven-word",
      "lang": "ja",
      "lyrics": "stranger-than-heaven/lyrics.txt",
      "transcript": "stranger-than-heaven/transcript.word.json"
    },
    {
      "name": "stranger-than-heaven-segment",
      "lang": "ja",
      "lyrics": "stranger-than-heaven/lyrics.txt",
      "transcript": "stranger-than-heaven/transcript.segment.json"
    },
    {
      "name": "guitar-loneliness-word",
      "lang": "ja",
      "lyrics": "guitar-loneliness/lyrics.ja.txt",
      "transcript": "guitar-loneliness/transcript.word.json"
    },
    {
      "name": "guitar-loneliness-segment",
      "lang": "ja",
      "lyrics": "guitar-loneliness/lyrics.ja.txt",
      "transcript": "guitar-loneliness/transcript.segment.json"
    },
    {
      "name": "akfg-user-word",
      "lang": "ja",
      "lyrics": "akfg-user-ja.txt",
      "transcript": "akfg-user/transcript.word.json"
    },
    {
      "name": "akfg-user-segment",
      "lang": "ja",
      "lyrics": "akfg-user-ja.txt",
      "transcript": "akfg-user/transcript.segment.json"
    }
```

(`lang` stays `"ja"` for the mixed song — that is what the app passes; the aligner's char normalization handles Latin text.)

- [ ] **Step 3: Run the full scorecard**

Run: `npx tsx scripts/audit-corpus.mjs`
Expected: 10 rows, boundary columns populated. This run produces the raw findings for Task 7.

- [ ] **Step 4: Run the corpus CI test** (it now loads 10 songs; baseline has no rows for the new 6, which the test must tolerate — check its behavior; if it throws on a missing baseline row, guard with `if (!baseline[song.name]) return` mirroring `checkBaseline`'s `if (!b) continue`).

Run: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-pipeline/fixtures/akfg-user tests/ai-pipeline/fixtures/corpus.json tests/ai-pipeline/corpus-scorecard.test.ts
git commit -m "test(fixtures): register expanded 10-song audit corpus"
```

---

### Task 7: Findings report — measure, attribute, rank

**Files:**
- Create: `docs/superpowers/2026-07-line-boundary-findings.md`

- [ ] **Step 1: Capture the scorecard**

Run: `npx tsx scripts/audit-corpus.mjs | tee /tmp/scorecard.txt` — then for every song where `bnd_early_p2 > 0` or `bnd_late_p2 > 0` or `bnd_midword_p2 > 0`, identify the exact offending lines by adding a temporary `--verbose-boundaries` style dump OR (simpler, no flag needed) write a small throwaway `npx tsx` snippet that loads that song's fixtures, runs both passes, and prints per-line `endTime` vs `span.lastEndTime` / next `span.firstTime` deltas for lines exceeding thresholds.

- [ ] **Step 2: Write the findings doc** with, per defect: song, line index + text, pass attribution (`introduced in pass 1 and not repaired` / `repaired by pass 2` / `introduced by pass 2`), delta in seconds, and suspected mechanism. Prime suspects for line-END defects are the pass-2 tail tuners in `refineAlignmentWithPhrases` (phraseAlignment.ts:1438-1446): `extendValidatedLineTails`, `clipSilencePaddedLineTails`, `snapBoundaryToGlyphTransition`, `snapLinesToOwnedChunks`; for pass-1 defects, `ensureVisibleLineWindows` and the char-offset interpolation in `buildTransChars`. Rank defect classes by (count across corpus) × (max delta). Explicitly separate defects caused by Whisper transcript quality (missing/mis-timed words — verify by reading the fixture transcript around the timestamps) into a "not fixable in alignment" section with evidence, per the spec's success-bar carve-out.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-07-line-boundary-findings.md
git commit -m "docs: line-boundary findings across expanded corpus"
```

---

### Task 8: Fix loop — one task per defect class from Task 7

The concrete defects are unknown until Task 7 runs, so this task defines the **required procedure for each defect class**, in ranked order. Repeat until the success bar (Task 9 Step 1) is met.

**Files (per iteration):**
- Test: `tests/ai-pipeline/lineBoundary.<defect-slug>.test.ts` (create)
- Modify: whichever of `src/lyrics/phraseAlignment.ts` / `src/ai-pipeline/contentAligner.ts` / `src/ai-pipeline/aligner.ts` the findings attribute

- [ ] **Step 1: Write the failing fixture-based test.** Template — load the real fixtures for the worst-affected song and assert the specific line's boundary. Example shape (adjust song/paths/line index to the actual finding):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures/stranger-than-heaven')

function loadWords(p: string) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

describe('line boundary: <defect description>', () => {
  it('line <N> ends where its last sung word ends', () => {
    const lineTexts = readFileSync(join(FIX, 'lyrics.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
    const words = loadWords(join(FIX, 'transcript.segment.json'))
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(words))
    const N = 0 // <- the offending line index from the findings
    const span = spans[N]!
    expect(span.lastEndTime - refined.lines[N].endTime).toBeLessThanOrEqual(0.35)
  })
})
```

- [ ] **Step 2: Run it, verify it fails** with the delta the findings predicted.
- [ ] **Step 3: Fix the attributed mechanism** in the pass identified — smallest change that makes the test pass. Study the target function's existing comment block first; every tuner in phraseAlignment.ts documents the song/bug that motivated it, and a fix must not undo those (their tests exist under `tests/ai-pipeline/`, e.g. `lineTailOffset.test.ts`, `orphanTailFill.test.ts`, `akfg-*.test.ts`).
- [ ] **Step 4: Run the new test (PASS) + the whole ai-pipeline suite** — `npx vitest run tests/ai-pipeline --reporter=dot` — zero failures.
- [ ] **Step 5: Re-run the scorecard** — `npx tsx scripts/audit-corpus.mjs` — the targeted `bnd_*` count drops; NO other metric on ANY song increases (compare against the Task 7 capture, since baseline isn't updated yet).
- [ ] **Step 6: Commit** — `git commit -m "fix(align): <defect class> — <mechanism>"` with the test + fix together.
- [ ] **Step 7: Repeat** for the next ranked defect class until the success bar is met or remaining defects are all in the documented Whisper-caused carve-out.

---

### Task 9: Lock the baseline + final verification

**Files:**
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (regenerated)
- Modify: `docs/superpowers/2026-07-line-boundary-findings.md` (final results section)

- [ ] **Step 1: Verify the success bar** from the spec against the final scorecard:
  - `bnd_late_p1` = `bnd_late_p2` = 0 for every song;
  - `bnd_early_p1` = `bnd_early_p2` = 0 for every song (excluding documented Whisper-caused carve-outs);
  - stranger-than-heaven unmatched-line rate (lines with null spans that are not `beyond_audio`, out of measurable lines) ≤ 1.5× the corpus median;
  - every pre-existing metric ≤ its value in the pre-work baseline capture.

- [ ] **Step 2: Snapshot the new baseline**

Run: `npx tsx scripts/audit-corpus.mjs --write-baseline` then `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: `✓ No regressions vs baseline.`

- [ ] **Step 3: Full test suite**

Run: `npx vitest run --reporter=dot`
Expected: zero failures (memory notes some pre-existing flaky integration tests — a failure is acceptable ONLY if it also fails on `main` unchanged; verify with `git stash && npx vitest run <file> && git stash pop` before dismissing).

- [ ] **Step 4: Append final before/after scorecard to the findings doc, commit everything**

```bash
git add tests/ai-pipeline/fixtures/corpus-baseline.json docs/superpowers/2026-07-line-boundary-findings.md
git commit -m "test(audit): lock boundary-accuracy baseline for expanded corpus"
```

---

## Self-review notes

- **Spec coverage:** corpus expansion (Tasks 5-6), boundary metrics incl. beyond-audio (Task 2-3), per-pass attribution (Tasks 3-4, 7), fix loop with TDD + non-regression (Task 8), success bar + baseline lock (Task 9). Lyrics fixtures were committed during brainstorming. ✓
- **Known unknown:** Task 8's concrete fixes depend on Task 7's measurements by design (measure-then-fix); the procedure, test template, suspect list, and exit criteria are fully specified.
- **Type consistency:** `LineMatchedSpan {firstTime,lastEndTime,matchedChars,totalChars}` is used identically in Tasks 1, 2, 4, 8; metric keys `bnd_*` match between Tasks 3, 4, 9.
