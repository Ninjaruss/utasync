# Selective Anchored CTC Refine — Offline Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether a *selective* CTC refiner — applied only to untrusted lines, inside windows pinned by consensus/good anchor lines from the shipped pipeline — beats the current word-mode + mixed-consensus baseline on dense code-switched songs (Recollect), with a pre-committed GO/NO-GO gate.

**Architecture:** A new permanent scorecard script (`scripts/hybrid-align-scorecard.mjs`) runs the REAL app aligner as baseline (mixed two-pass merge for mixed sheets), extracts trusted anchor lines, and re-times only the lines *between* anchors via mms-300m CTC Viterbi over each window's logit slice. A small behavior-neutral export from `mixedLanguageAlign.ts` exposes the consensus skeleton; window construction lives in a unit-tested pure module.

**Tech Stack:** node + tsx, `@huggingface/transformers` (mms-300m-1130-forced-aligner-ONNX q8, cached from prior runs), kuroshiro romanization, vitest, existing fixtures + LRC truth.

**Critical prior-art note (changes what "new" means here):** commit `531e0d3` already measured the *blanket* hybrid (fixed 4-line groups, all lines refined) — MIXED result, do not adopt: helps mediocre songs (guitar 0.87→0.61), hurts good ones (veil 0.38→1.32). Its own conclusion: the only plausible role is a **selective refiner applied solely to uncertain lines, anchored by trusted lines — unvalidated**. That variant is THIS spike. Also: Recollect (the target song) was never in any CTC scorecard, and the old coarse baseline predates word-mode-everywhere and never used the mixed two-pass merge. Do not re-run the blanket variant; `scripts/forced-align-scorecard.mjs` already has it.

**Interpretation guardrails (from prior dead-ends):**
- Bounds must be independent of the CTC path (Whisper/consensus placements only).
- Never leave a window open-ended (naive-windowing smear, mean 39s).
- Refining lines whose baseline is already good is how `531e0d3` LOST on veil — anchor lines always keep their baseline times, and windows whose interior is already trusted are skipped.

---

### Task 1: Branch + local audio staging

**Files:** none committed (audio is local-only).

- [ ] **Step 1: Create the spike branch off main**

```bash
cd /Users/ninjaruss/Documents/GitHub/utasync
git checkout main && git pull && git checkout -b spike/hybrid-ctc-refine
```

- [ ] **Step 2: Stage Recollect + Going My Way audio into public/e2e (local-only)**

```bash
cp "/Users/ninjaruss/Downloads/re-zero-season-4-opening-full-recollect-by-konomi-suzuki-feat-ashnikko-lyrics-128-ytshorts.savetube.me.mp3" public/e2e/recollect.mp3
cp "/Users/ninjaruss/Downloads/yugioh-5d-s-opening-5-road-to-tomorrow-going-my-way-128-ytshorts.savetube.me.mp3" public/e2e/going-my-way.mp3
git status --short public/e2e/
```

Expected: `git status` shows NOTHING for the mp3s (public/e2e audio is untracked by design). If they appear as untracked additions that would be committed, STOP and check `.gitignore` — do not commit audio.

- [ ] **Step 3: Best-effort Going My Way truth fetch (guard song only — skip freely)**

Going-my-way has no in-repo lyrics/truth (the July run used `--extra` with files now gone). Try LRCLIB:

```bash
curl -s "https://lrclib.net/api/search?q=Going+My+Way+%E9%81%A0%E8%97%A4%E6%AD%A3%E6%98%8E" | head -c 2000
```

If a result has `syncedLyrics` matching a ~1:30–4:30 duration track: save `{"syncedLyrics": "..."}` to `tests/ai-pipeline/fixtures/lrc-truth/going-my-way.json` and the plain lines (timestamps stripped) to `tests/ai-pipeline/fixtures/going-my-way/lyrics.txt`, then commit:

```bash
git add tests/ai-pipeline/fixtures/lrc-truth/going-my-way.json tests/ai-pipeline/fixtures/going-my-way/lyrics.txt
git commit --no-gpg-sign -m "test(align): going-my-way LRC truth + lyrics fixture"
```

If LRCLIB has nothing usable, record "going-my-way guard skipped — truth unavailable" for the findings memo and move on. This song must NOT block the spike.

---

### Task 2: Export the consensus skeleton from mixedLanguageAlign (behavior-neutral)

**Files:**
- Modify: `src/ai-pipeline/mixedLanguageAlign.ts` (the `agreed` computation inside `mergeMixedRefinedAlignments`, ~line 120; `MixedAlignmentResult` + `refineMixedLanguageAlignment`, ~line 285)
- Test: `tests/ai-pipeline/consensusAnchors.test.ts` (create)

The merge already computes cross-pass agreed lines internally (`AGREE_TOL = 2.5`, both passes rank ≥ 1). The scorecard needs that list and the two inner passes. Two additive changes, zero behavior change.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai-pipeline/consensusAnchors.test.ts
import { describe, expect, it } from 'vitest'
import { consensusAgreedLines, refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

function fakePass(starts: (number | null)[], ranks: number[]): RefinedAlignment {
  return {
    lines: starts.map((s) => (s == null ? { original: 'x', translation: '', startTime: 0, endTime: 0 } : { original: 'x', translation: '', startTime: s, endTime: s + 2 })),
    phrases: [],
    mode: 'content',
    confidence: 0.9,
    lineAlignmentQuality: ranks.map((r) => (r >= 2 ? 'good' : r === 1 ? 'approximate' : 'needs_review')),
    anchorSources: ranks.map((r) => (r >= 1 ? 'content' : 'proportional')),
  } as unknown as RefinedAlignment
}

describe('consensusAgreedLines', () => {
  it('returns lines where both passes agree within tolerance and both have evidence', () => {
    const ja = fakePass([10, 20, 30, 40], [2, 2, 2, 0])
    const en = fakePass([10.5, 28, 30.2, 40], [2, 2, 2, 0])
    const agreed = consensusAgreedLines(ja, en)
    // line 0: |10-10.5|<=2.5 both evidenced -> agreed at midpoint
    // line 1: |20-28|>2.5 -> not agreed
    // line 2: agreed; line 3: no evidence (rank 0) -> not agreed
    expect(agreed.map((a) => a.li)).toEqual([0, 2])
    expect(agreed[0].time).toBeCloseTo(10.25, 5)
  })
})

describe('refineMixedLanguageAlignment passes exposure', () => {
  it('returns the inner ja/en passes', () => {
    const rows = [{ original: 'テスト line', translation: '', startTime: 0, endTime: 0 }]
    const words = [{ word: 'テスト', startTime: 1, endTime: 2 }]
    const res = refineMixedLanguageAlignment(rows, words, words)
    expect(res.passes?.ja?.lines).toHaveLength(1)
    expect(res.passes?.en?.lines).toHaveLength(1)
  })
})
```

Note: `fakePass` must satisfy whatever `lineRank` inside `mixedLanguageAlign.ts` actually reads (inspect it — it derives rank from quality/anchorSources). Adjust the fake's fields to drive rank ≥ 1 for evidenced lines and 0 for the last line; the assertion structure stays the same.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ai-pipeline/consensusAnchors.test.ts --exclude "**/.claude/**"
```

Expected: FAIL — `consensusAgreedLines` is not exported / `passes` undefined.

- [ ] **Step 3: Implement — extract + expose, no behavior change**

In `src/ai-pipeline/mixedLanguageAlign.ts`:

```typescript
/**
 * Cross-pass consensus skeleton: lines where the two forced-language passes
 * independently agree (within AGREE_TOL) and both carry real evidence.
 * Exported for offline instruments (hybrid-align-scorecard); the merge below
 * consumes it unchanged.
 */
export const CONSENSUS_AGREE_TOL = 2.5
export function consensusAgreedLines(
  ja: RefinedAlignment,
  en: RefinedAlignment,
): { li: number; time: number }[] {
  const n = Math.min(ja.lines.length, en.lines.length)
  const agreed: { li: number; time: number }[] = []
  for (let li = 0; li < n; li++) {
    const jt = ja.lines[li]?.startTime
    const et = en.lines[li]?.startTime
    if (jt == null || et == null) continue
    if (Math.abs(jt - et) <= CONSENSUS_AGREE_TOL && lineRank(ja, li) >= 1 && lineRank(en, li) >= 1) {
      agreed.push({ li, time: (jt + et) / 2 })
    }
  }
  return agreed
}
```

Inside `mergeMixedRefinedAlignments`, delete the local `AGREE_TOL` constant and the inline `agreed` loop; replace with:

```typescript
  const agreed = consensusAgreedLines(ja, en)
```

(The `CONSENSUS_MIN`/`DEVIATION_TRIGGER`/`IMPROVE_MIN` constants and everything downstream stay put.)

In `MixedAlignmentResult` add:

```typescript
export interface MixedAlignmentResult {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  pickedFrom: MixedPassSource[]
  /** Inner forced-language passes, exposed for offline instruments. */
  passes: { ja: RefinedAlignment; en: RefinedAlignment }
}
```

and in `refineMixedLanguageAlignment`'s return: `return { refined, transcriptWords, pickedFrom, passes: { ja: jaPass, en: enPass } }`.

- [ ] **Step 4: Run the new test + full guard rails**

```bash
npx vitest run tests/ai-pipeline/consensusAnchors.test.ts --exclude "**/.claude/**"
npx vitest run --exclude "**/.claude/**"
npx tsx scripts/audit-corpus.mjs --check-baseline
npx tsc --noEmit
```

Expected: new test PASS, full suite green (known flaky: `AutoAlignFlow.unload.test.tsx` under full-suite load — rerun isolated if it trips), corpus baseline byte-identical, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/mixedLanguageAlign.ts tests/ai-pipeline/consensusAnchors.test.ts
git commit --no-gpg-sign -m "refactor(align): export consensus skeleton + inner passes for offline instruments"
```

---

### Task 3: Window construction module (pure, unit-tested)

**Files:**
- Create: `scripts/lib/selectiveWindows.mjs`
- Test: `tests/ai-pipeline/selectiveWindows.test.ts`

Pure function: baseline line times + anchor indices → closed refine-windows over only-untrusted interiors, with the density guard. All CTC-free, so fully unit-testable.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai-pipeline/selectiveWindows.test.ts
import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs module without types
import { buildSelectiveWindows } from '../../scripts/lib/selectiveWindows.mjs'

// lines: baseline start times; tokensPerLine: romanized token counts
const base = (starts: number[]) => starts.map((s) => ({ startTime: s }))

describe('buildSelectiveWindows', () => {
  it('creates one closed window per anchor gap containing untrusted lines', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 5, 9, 20, 24, 30]),
      tokensPerLine: [10, 10, 10, 10, 10, 10],
      anchorIdx: [0, 3, 5],
      durationSec: 40,
      padSec: 1,
    })
    // gap 0..3 interior = lines 1,2 ; gap 3..5 interior = line 4
    expect(wins).toHaveLength(2)
    expect(wins[0]).toMatchObject({ lineIdx: [1, 2], t0: 0, t1: 21 }) // 1-1=0 clamped, 20+1
    expect(wins[1]).toMatchObject({ lineIdx: [4], t0: 19, t1: 31 })
  })

  it('closes head and tail windows at 0 and duration', () => {
    const wins = buildSelectiveWindows({
      lines: base([5, 10, 15]),
      tokensPerLine: [8, 8, 8],
      anchorIdx: [1],
      durationSec: 60,
      padSec: 0,
    })
    expect(wins[0]).toMatchObject({ lineIdx: [0], t0: 0, t1: 10 })
    expect(wins[1]).toMatchObject({ lineIdx: [2], t0: 10, t1: 60 })
  })

  it('skips windows whose token density is implausible (too dense to fit)', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2, 3]),
      tokensPerLine: [0, 100, 0],
      anchorIdx: [0, 2],
      durationSec: 10,
      padSec: 0, // window 1..3 = 2s for 100 tokens -> 50 tok/s > max
    })
    expect(wins).toHaveLength(0)
  })

  it('skips windows that are mostly empty space (smear risk)', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2, 100]),
      tokensPerLine: [10, 3, 10],
      anchorIdx: [0, 2],
      durationSec: 120,
      padSec: 0, // 3 tokens across ~99s -> 33 s/token > max
    })
    expect(wins).toHaveLength(0)
  })

  it('skips gaps with no untrusted interior and returns [] with <2 anchors', () => {
    expect(buildSelectiveWindows({
      lines: base([1, 2]), tokensPerLine: [5, 5], anchorIdx: [0, 1], durationSec: 10, padSec: 1,
    })).toHaveLength(0)
    expect(buildSelectiveWindows({
      lines: base([1, 2]), tokensPerLine: [5, 5], anchorIdx: [0], durationSec: 10, padSec: 1,
    })).toHaveLength(1) // head window is still closed [0, anchor]; tail window [anchor, dur]
  })
})
```

(Adjust the last expectation once semantics are settled in Step 3: with a single anchor, head interior = lines before it, tail interior = lines after it — here line 1 exists after anchor 0, so exactly 1 window.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ai-pipeline/selectiveWindows.test.ts --exclude "**/.claude/**"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// scripts/lib/selectiveWindows.mjs
/**
 * Selective refine-window construction for the hybrid CTC spike.
 * Windows are CLOSED on both sides by anchor-line baseline starts (or 0/duration
 * at the song edges) — never open-ended (the naive-windowing smear dead-end) and
 * never derived from CTC output (the self-anchoring dead-end). Only gaps that
 * contain untrusted interior lines become windows; anchor lines are never
 * re-timed.
 */
export const MAX_TOKENS_PER_SEC = 12 // sung romaji rarely exceeds ~10 chars/s
export const MAX_SEC_PER_TOKEN = 4   // mostly-instrumental window: CTC would smear

export function buildSelectiveWindows({ lines, tokensPerLine, anchorIdx, durationSec, padSec }) {
  const n = lines.length
  const anchors = [...anchorIdx].sort((a, b) => a - b)
  // Virtual song-edge anchors at t=0 and t=duration.
  const bounds = [
    { idx: -1, t: 0 },
    ...anchors.map((i) => ({ idx: i, t: lines[i].startTime })),
    { idx: n, t: durationSec },
  ]
  const windows = []
  for (let b = 0; b + 1 < bounds.length; b++) {
    const lo = bounds[b]
    const hi = bounds[b + 1]
    const lineIdx = []
    let tokens = 0
    for (let li = lo.idx + 1; li < hi.idx; li++) {
      if (tokensPerLine[li] > 0) { lineIdx.push(li); tokens += tokensPerLine[li] }
    }
    if (!lineIdx.length) continue
    const t0 = Math.max(0, lo.t - padSec)
    const t1 = Math.min(durationSec, hi.t + padSec)
    const span = t1 - t0
    if (span <= 0) continue
    if (tokens / span > MAX_TOKENS_PER_SEC) continue
    if (span / tokens > MAX_SEC_PER_TOKEN) continue
    windows.push({ lineIdx, t0, t1 })
  }
  return windows
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/ai-pipeline/selectiveWindows.test.ts --exclude "**/.claude/**"
```

Expected: PASS (fix the Step-1 expected numbers if the clamp arithmetic disagrees — the SEMANTICS in the module comment are the contract, the literals in the test follow it).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/selectiveWindows.mjs tests/ai-pipeline/selectiveWindows.test.ts
git commit --no-gpg-sign -m "test(align): selective refine-window construction for hybrid CTC spike"
```

---

### Task 4: hybrid-align-scorecard.mjs — app-path baseline

**Files:**
- Create: `scripts/hybrid-align-scorecard.mjs`

Baseline first, standalone-runnable, before any CTC. Pattern after `scripts/forced-align-scorecard.mjs` (reuse its `loadTranscriptWords`, decode/resample, romanize, truth-scoring shapes) but: (a) mixed sheets run the REAL `refineMixedLanguageAlignment` (word-JA + segment-forced-EN — the app's actual pass shapes), (b) report BOTH raw and offset-normalized error (the offset trick hides real lag — aligner-test-bias-audit).

- [ ] **Step 1: Write the script (baseline mode)**

```javascript
// scripts/hybrid-align-scorecard.mjs
/**
 * SPIKE (selective anchored CTC refine): does a CTC refiner applied ONLY to
 * untrusted lines, inside windows pinned by trusted anchor lines from the
 * shipped pipeline, beat the current word-mode + mixed-consensus baseline on
 * dense code-switched songs?
 *
 * Prior art: 531e0d3 measured the BLANKET hybrid (all lines, 4-line groups) —
 * mixed result, do not adopt. This is the selective variant that commit's
 * conclusion flagged as the only plausible-but-unvalidated role.
 *
 *   npx tsx scripts/hybrid-align-scorecard.mjs                # baseline table
 *   npx tsx scripts/hybrid-align-scorecard.mjs --selective    # + CTC refine
 *   npx tsx scripts/hybrid-align-scorecard.mjs --sweep        # pad/policy sweep
 *   flags: --song <name> --pad <s> --anchors consensus|good|both --debug
 *
 * Never prints lyric text — indices and times only.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const F = (p) => join(root, p)

const SONGS = [
  {
    name: 'recollect', mixed: true,
    audio: F('public/e2e/recollect.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/recollect/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/recollect/transcript.word.json'),
    en: F('tests/ai-pipeline/fixtures/recollect/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/recollect.json'),
  },
  {
    name: 'stranger-than-heaven', mixed: true,
    audio: F('public/e2e/stranger.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt'),
    ja: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json'),
    en: F('tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.segment.forced-en.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/stranger-than-heaven.json'),
  },
  {
    name: 'guitar-loneliness', mixed: false,
    audio: F('public/e2e/guitar.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/guitar-loneliness/transcript.word.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/guitar-loneliness.json'),
  },
  {
    name: 'veil', mixed: false,
    audio: F('public/e2e/veil.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/veil/lyrics.ja.txt'),
    ja: F('tests/ai-pipeline/fixtures/veil/transcript.words.json'),
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/veil.json'),
  },
  {
    name: 'going-my-way', mixed: false,
    audio: F('public/e2e/going-my-way.mp3'),
    lyrics: F('tests/ai-pipeline/fixtures/going-my-way/lyrics.txt'), // optional (Task 1 Step 3)
    ja: null, // no committed transcript: baseline for this song is CTC-monolithic only; skip in baseline mode
    truth: F('tests/ai-pipeline/fixtures/lrc-truth/going-my-way.json'),
  },
]

/** Word array or {chunks:[{text,timestamp}]} — mirrors forced-align-scorecard. */
function loadTranscriptWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(raw)) {
    return raw.flatMap((w) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime, endTime: w.endTime }]
    })
  }
  return (raw.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

const { refineAlignmentWithPhrases } = await import(pathToFileURL(F('src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment, consensusAgreedLines } = await import(pathToFileURL(F('src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { detectSheetLanguage } = await import(pathToFileURL(F('src/ai-pipeline/whisperLanguage.ts')).href)
const { parseLrc, matchSheetToLrc } = await import(pathToFileURL(F('scripts/lib/lrcTruth.mjs')).href)

/** Raw + offset-normalized line-start error vs truth. */
function score(lineTimes, truth) {
  const idx = []
  for (let i = 0; i < truth.length; i++) if (truth[i] != null && lineTimes[i] != null) idx.push(i)
  const raw = idx.map((i) => Math.abs(lineTimes[i] - truth[i]))
  const diffs = idx.map((i) => lineTimes[i] - truth[i]).sort((a, b) => a - b)
  const off = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  const norm = idx.map((i) => Math.abs(lineTimes[i] - (truth[i] + off)))
  const stats = (errs) => {
    const e = [...errs].sort((a, b) => a - b)
    return {
      mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
      p50: e[Math.floor(0.5 * e.length)] ?? 0,
      p90: e[Math.floor(0.9 * e.length)] ?? 0,
      over1: errs.filter((x) => x > 1).length,
      over15: errs.filter((x) => x > 1.5).length,
    }
  }
  return { scored: idx.length, offset: off, raw: stats(raw), norm: stats(norm) }
}

/** Baseline app-path alignment; returns { lines, anchors: {consensus, good} }. */
function runBaseline(song, lineTexts) {
  const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  if (song.mixed) {
    const jaWords = loadTranscriptWords(song.ja)
    const enWords = loadTranscriptWords(song.en)
    const res = refineMixedLanguageAlignment(rows, jaWords, enWords)
    const consensus = consensusAgreedLines(res.passes.ja, res.passes.en).map((a) => a.li)
    const good = res.refined.lineAlignmentQuality
      .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
    return { lines: res.refined.lines, quality: res.refined.lineAlignmentQuality, anchors: { consensus, good } }
  }
  const words = loadTranscriptWords(song.ja)
  const lang = detectSheetLanguage(lineTexts, 'ja')
  const refined = refineAlignmentWithPhrases(rows, words, lang)
  const good = (refined.lineAlignmentQuality ?? [])
    .map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
  return { lines: refined.lines, quality: refined.lineAlignmentQuality, anchors: { consensus: good, good } }
}

const only = process.argv.indexOf('--song') >= 0 ? process.argv[process.argv.indexOf('--song') + 1] : null
const rows = []
for (const song of SONGS) {
  if (only && song.name !== only) continue
  if (!song.ja || !existsSync(song.ja) || !existsSync(song.lyrics) || !existsSync(song.truth)) {
    console.log(`skip ${song.name} (missing fixture)`)
    continue
  }
  const lineTexts = readFileSync(song.lyrics, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  const base = runBaseline(song, lineTexts)
  const tj = JSON.parse(readFileSync(song.truth, 'utf8'))
  const truth = matchSheetToLrc(lineTexts, parseLrc(tj.syncedLyrics))
  const s = score(base.lines.map((l) => l.startTime), truth)
  rows.push({ name: `${song.name} (baseline)`, ...s, anchors: base.anchors.consensus.length })
  console.log(`${song.name}: baseline scored=${s.scored} rawMean=${s.raw.mean.toFixed(2)} normMean=${s.norm.mean.toFixed(2)} anchors=${base.anchors.consensus.length}`)
}

console.log('\n=== HYBRID SCORECARD ===')
console.log('config                                scored  anch | raw:  mean   p50   p90  >1s >1.5 | norm:  mean   p50   p90  >1s >1.5 | off')
for (const r of rows) {
  const f = (x) => x.toFixed(2).padStart(5)
  console.log(
    `${r.name.padEnd(37)} ${String(r.scored).padStart(5)} ${String(r.anchors ?? '').padStart(5)} |     ${f(r.raw.mean)} ${f(r.raw.p50)} ${f(r.raw.p90)} ${String(r.raw.over1).padStart(4)} ${String(r.raw.over15).padStart(4)} |      ${f(r.norm.mean)} ${f(r.norm.p50)} ${f(r.norm.p90)} ${String(r.norm.over1).padStart(4)} ${String(r.norm.over15).padStart(4)} | ${r.offset.toFixed(2)}`,
  )
}
```

- [ ] **Step 2: Run the baseline**

```bash
npx tsx scripts/hybrid-align-scorecard.mjs
```

Expected: a table with recollect + stranger (mixed path, consensus anchor counts printed) and guitar + veil (single path); going-my-way skipped (no transcript fixture). Sanity anchors: recollect norm mean should land near the memory's 2.89s (segment-era number — word-JA may differ; whatever it prints IS the new baseline), stranger norm p50 near 0.9, veil/guitar small. If a mixed song reports 0 scored lines or a >30s mean, debug the harness before proceeding (531e0d3's first run was invalidated by a fixture-shape bug — check `loadTranscriptWords` output count first).

- [ ] **Step 3: Record the baseline table** — paste the full output into the findings memo draft (`docs/superpowers/audits/2026-08-01-hybrid-ctc-refine-findings.md`, created now with just a "Baseline" section). This is the GO/NO-GO reference.

- [ ] **Step 4: Commit**

```bash
git add scripts/hybrid-align-scorecard.mjs docs/superpowers/audits/2026-08-01-hybrid-ctc-refine-findings.md
git commit --no-gpg-sign -m "test(align): hybrid scorecard baseline — app-path mixed two-pass vs LRC truth"
```

---

### Task 5: Selective CTC refine mode

**Files:**
- Modify: `scripts/hybrid-align-scorecard.mjs`

Add the CTC machinery (copy the working pieces from `scripts/forced-align-scorecard.mjs` — model load, `romanize`, `emissionsFor`, `align`; they are known-good) and the selective mode wired through `buildSelectiveWindows`.

- [ ] **Step 1: Add CTC pieces + selective refine**

Copy verbatim from `scripts/forced-align-scorecard.mjs` into the new script (guarded so baseline-only runs never load the model): the `VOCAB`/`CHAR2ID`/`BLANK`/`V` constants, `emissionsFor`, `align`, model+kuroshiro init, `romanize`, and the audio decode/resample block. Then:

```javascript
/**
 * Selective refine: keep every baseline time; re-time ONLY untrusted lines
 * inside closed anchor-bounded windows. Anchor lines are never touched — the
 * blanket hybrid (531e0d3) lost by refining lines that were already right.
 */
function refineSelective(em, frames, fps, lineTokens, baseLines, anchorIdx, durationSec, padSec, debug) {
  const out = baseLines.map((l) => l.startTime)
  const windows = buildSelectiveWindows({
    lines: baseLines, tokensPerLine: lineTokens.map((t) => t.length),
    anchorIdx, durationSec, padSec,
  })
  let refined = 0
  for (const w of windows) {
    const f0 = Math.max(0, Math.floor(w.t0 * fps))
    const f1 = Math.min(frames, Math.ceil(w.t1 * fps))
    const toks = w.lineIdx.flatMap((i) => lineTokens[i])
    if (f1 - f0 < toks.length) continue
    const r = align(em.subarray(f0 * V, f1 * V), f1 - f0, toks)
    let k = 0
    for (const i of w.lineIdx) {
      if (lineTokens[i].length && r.tokFrame[k] >= 0) { out[i] = (f0 + r.tokFrame[k]) / fps; refined++ }
      k += lineTokens[i].length
    }
    if (debug) console.log(`  win [${w.t0.toFixed(1)},${w.t1.toFixed(1)}]s lines=${w.lineIdx.join(',')} toks=${toks.length} unaligned=${r.unaligned}`)
  }
  if (debug) console.log(`  selective: ${windows.length} windows, ${refined} lines re-timed`)
  return out
}
```

In the main loop (only when `--selective` or `--sweep`): decode audio once per song, compute emissions once, then for each config score `refineSelective(...)` with:
- anchor policy `consensus` = `base.anchors.consensus`; `good` = `base.anchors.good`; `both` = union (sorted, deduped)
- `--sweep` = pad ∈ {0.5, 1, 2} × policy ∈ {consensus, both} for mixed songs; single-language songs run policy `good` only (their consensus IS good)

Each config appends a row: `` `${song.name} sel/${policy}/pad${pad}` `` so the final table shows baseline vs every config side by side. Import at top:

```javascript
const { buildSelectiveWindows } = await import(pathToFileURL(F('scripts/lib/selectiveWindows.mjs')).href)
```

- [ ] **Step 2: Smoke-run one song**

```bash
npx tsx scripts/hybrid-align-scorecard.mjs --song recollect --selective --debug
```

Expected: model loads (cached, no full re-download), window list prints with plausible bounds (windows a few seconds to ~30s wide, not song-length), a `sel/consensus/pad1` row appears. If every window is skipped by the density guard, print WHY (tokens/span numbers) and revisit thresholds — record any threshold change in the memo.

- [ ] **Step 3: Commit**

```bash
git add scripts/hybrid-align-scorecard.mjs
git commit --no-gpg-sign -m "test(align): selective anchored CTC refine mode in hybrid scorecard"
```

---

### Task 6: Full sweep, gate verdict, findings memo, memory

**Files:**
- Modify: `docs/superpowers/audits/2026-08-01-hybrid-ctc-refine-findings.md`
- Modify: memory `forced-alignment-and-tap-anchor.md` + new/updated memory for this spike

- [ ] **Step 1: Run the full sweep**

```bash
npx tsx scripts/hybrid-align-scorecard.mjs --sweep 2>&1 | tee /tmp/hybrid-sweep.log
```

(Long: ~1–2 min CTC inference per song plus decode; 4–5 songs.) Paste the complete table into the findings memo.

- [ ] **Step 2: Evaluate the pre-committed gate (from the spec, verbatim)**

- **GO:** Recollect norm mean AND norm p90 improve ≥25% vs the Task-4 baseline at some single config, AND stranger/guitar/veil (+going-my-way if present) regress on no metric by >10% at that same config.
- **NO-GO:** anything less. No post-hoc gate softening — if it's close-but-miss, it's NO-GO with the numbers recorded.

- [ ] **Step 3: Write the verdict memo**

Findings memo sections: Baseline table; Sweep table; Verdict (GO/NO-GO + the config, or the miss); Window diagnostics (how many windows/lines refined per song, density-guard skips); Threshold deviations (any density-guard tuning, with before/after); Next step (on GO: in-app design round; on NO-GO: dead-end #7 recorded, what signal would reopen it).

- [ ] **Step 4: Update memory**

Update `~/.claude/projects/-Users-ninjaruss-Documents-GitHub-utasync/memory/forced-alignment-and-tap-anchor.md`: the "next experiment if resumed" hybrid WAS run same-day (commit `531e0d3`, blanket variant, MIXED — do not adopt); add this spike's selective-variant result. Write a new memory file for this spike's outcome + `MEMORY.md` index line.

- [ ] **Step 5: Commit + hand back**

```bash
git add docs/superpowers/audits/2026-08-01-hybrid-ctc-refine-findings.md
git commit --no-gpg-sign -m "docs(align): selective anchored CTC refine — spike verdict"
```

Then report the verdict table to the user. On GO: propose the in-app design round (ship vehicle, 340MB download UX, tier gating). On NO-GO: the branch stays as a record branch like `feat/forced-alignment`; do not merge app-code Task 2 unless the export is wanted anyway (it is harmless and tested — offer it as a tiny standalone PR).

---

## Verification checklist (whole spike)

- `npx vitest run --exclude "**/.claude/**"` green (known flaky: `AutoAlignFlow.unload.test.tsx` under load)
- `npx tsx scripts/audit-corpus.mjs --check-baseline` byte-identical (Task 2 is the only app-code change)
- `npx tsc --noEmit` + `npx eslint .` clean
- No lyric text printed by the scorecard (indices/times only)
- No audio files committed
