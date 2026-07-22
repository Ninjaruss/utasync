# Forced Alignment — Phase 1 (Spike + Bake-off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine, by measurement, whether CTC forced alignment beats the current transcribe-then-match baseline on hard/mixed songs — building the reusable forced-aligner core along the way.

**Architecture:** A pure Viterbi forced-alignment core + a text→token normalizer, wired to a transformers.js CTC model behind `forceAlignLines(audio, sampleRate, lines)`. A Node harness scores it against LRC ground truth (Recollect, stranger-mixed, veil) vs the current baseline. No app changes in Phase 1.

**Tech Stack:** TypeScript, `@huggingface/transformers` v3.8.1 (Node + browser), `tsx`, vitest. Reuses `scripts/lib/nodeAudio.mjs`, `scripts/lib/lrcTruth.mjs`, `src/language/japanese/phonetics.ts` (`toRomaji`).

**Spec:** `docs/superpowers/specs/2026-07-22-forced-alignment-design.md`

> **Execution note (2026-07-22, after Task 1 spike):** GO on the mechanism, but the only
> loadable CTC model is `Xenova/wav2vec2-base-960h` (English; uppercase A–Z vocab, blank id 0,
> `|` word-sep id 4). Adaptations carried in the subagent dispatches: (a) `normalize`
> **uppercases** text (the vocab is A–Z, not lowercase); JA lines are romanized (`toRomaji`,
> a–z) → uppercased → fed to the *same* model — its quality on JA audio is **measured by the
> bake-off, not assumed**; (b) Task 4 `CTC_MODEL = 'Xenova/wav2vec2-base-960h'`; (c) the
> bake-off (Task 5) runs on the readable in-repo `public/e2e/stranger.mp3` (mixed JA/EN) +
> `veil.mp3` (JA), since the sandbox blocks the Downloads mp3 and stranger has committed LRC
> truth. If EN forced-align validates, resolve the multilingual/JA model (a portable MMS/JA
> CTC checkpoint, or pivot to the inherently-multilingual Whisper-attention approach B) in a
> follow-on.

---

## File Structure

- `scripts/spike-ctc-emissions.mjs` — throwaway spike: prove a CTC model loads and exposes per-frame logits in Node. Deleted after Task 1.
- `src/ai-pipeline/forcedAlign/viterbi.ts` — pure CTC forced-alignment DP (emissions + target tokens → per-token frame spans). No model, no I/O.
- `src/ai-pipeline/forcedAlign/normalize.ts` — pure line-text → model-vocab token id sequence (EN chars; JA via `toRomaji`).
- `src/ai-pipeline/forcedAlign/forcedAligner.ts` — `forceAlignLines(...)`: run the CTC model, call normalize + viterbi, map frames→seconds→line timings.
- `tests/ai-pipeline/forcedAlign/viterbi.test.ts` — deterministic unit tests (synthetic emissions).
- `tests/ai-pipeline/forcedAlign/normalize.test.ts` — deterministic unit tests.
- `scripts/bakeoff-forced-align.mjs` — Node harness: forced align vs baseline vs LRC truth on the corpus. Prints the decision table.

---

## Task 1: Feasibility spike — CTC emissions in transformers.js (Node)

**Goal:** Confirm a CTC model loads in this repo's transformers.js and returns per-frame logits `[1, T, V]` plus a readable vocab. This is a go/no-go gate for approach A. Exploratory (not TDD).

**Files:**
- Create: `scripts/spike-ctc-emissions.mjs`

- [ ] **Step 1: Write the spike script**

```js
// scripts/spike-ctc-emissions.mjs — THROWAWAY (deleted in Step 4).
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { AutoModelForCTC, AutoProcessor } = await import('@huggingface/transformers')

const MP3 = process.argv[2] || '/Users/ninjaruss/Downloads/re-zero-season-4-opening-full-recollect-by-konomi-suzuki-feat-ashnikko-lyrics-128-ytshorts.savetube.me.mp3'
// Candidate models, most-multilingual first. The spike records which load.
const CANDIDATES = ['Xenova/mms-300m', 'Xenova/wav2vec2-large-xlsr-53', 'Xenova/wav2vec2-base-960h']

const { data, sampleRate } = await decodeMp3ToMono(MP3)
// CTC wav2vec2 expects 16kHz mono; nodeAudio decodes at device rate — resample crudely for the spike.
const ratio = sampleRate / 16000
const n16 = Math.floor(data.length / ratio)
const audio16 = new Float32Array(n16)
for (let i = 0; i < n16; i++) audio16[i] = data[Math.floor(i * ratio)]
const slice = audio16.subarray(0, 16000 * 10) // 10s

for (const model of CANDIDATES) {
  try {
    console.log(`\n--- ${model} ---`)
    const processor = await AutoProcessor.from_pretrained(model)
    const ctc = await AutoModelForCTC.from_pretrained(model)
    const inputs = await processor(slice)
    const out = await ctc(inputs)
    const logits = out.logits
    console.log('logits dims:', logits.dims)         // expect [1, T, V]
    const vocabSize = logits.dims[logits.dims.length - 1]
    const id2label = ctc.config?.id2label ? Object.keys(ctc.config.id2label).length : 'n/a'
    console.log('vocab size:', vocabSize, 'id2label entries:', id2label)
    console.log('tokenizer decode sample:', typeof processor.tokenizer?.decode)
    console.log('OK — emissions accessible')
    break
  } catch (e) {
    console.log('FAILED:', String(e).slice(0, 160))
  }
}
```

- [ ] **Step 2: Run the spike**

Run: `npx tsx scripts/spike-ctc-emissions.mjs 2>&1 | grep -viE "onnxruntime|dtype|warning"`
Expected (GO): at least one model prints `logits dims: [ 1, T, V ]` and `OK — emissions accessible`, where T is in the low thousands for 10s and V is tens–hundreds.
Expected (NO-GO): every candidate FAILS to load or `out.logits` is undefined.

- [ ] **Step 3: Record the decision**

In `docs/superpowers/specs/2026-07-22-forced-alignment-design.md`, append a short "Phase 1 spike result" note: which model loaded, its `[T, V]` shape and vocab, and GO (approach A) or NO-GO (pivot to approach B — stop this plan and write a Whisper-cross-attention plan instead).

- [ ] **Step 4: Delete the spike and commit the note**

```bash
rm scripts/spike-ctc-emissions.mjs
git add docs/superpowers/specs/2026-07-22-forced-alignment-design.md
git commit --no-gpg-sign -m "spike(align): confirm CTC emissions accessible in transformers.js (forced-align phase 1)"
```

**STOP if NO-GO.** The remaining tasks assume a CTC model with accessible logits.

---

## Task 2: Viterbi CTC forced-alignment core (pure)

**Goal:** Given per-frame log-probabilities and a target token-id sequence, return the per-token frame span via monotonic CTC forced alignment (torchaudio-style trellis + backtrack). Pure, deterministic, no model.

**Files:**
- Create: `src/ai-pipeline/forcedAlign/viterbi.ts`
- Test: `tests/ai-pipeline/forcedAlign/viterbi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { forcedAlignCTC } from '../../../src/ai-pipeline/forcedAlign/viterbi'

// 3 frames, vocab {0:blank, 1:'a', 2:'b'}. Log-probs (natural log of a clear winner).
// frame0 -> 'a', frame1 -> blank, frame2 -> 'b'. Target tokens [1,2] ('a','b').
const L = Math.log
const emissions = [
  [L(0.1), L(0.8), L(0.1)], // a
  [L(0.8), L(0.1), L(0.1)], // blank
  [L(0.1), L(0.1), L(0.8)], // b
]

describe('forcedAlignCTC', () => {
  it('maps each target token to its most likely frame span, monotonically', () => {
    const spans = forcedAlignCTC(emissions, [1, 2], 0)
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual({ tokenIndex: 0, tokenId: 1, startFrame: 0, endFrame: 0 })
    expect(spans[1].tokenId).toBe(2)
    expect(spans[1].startFrame).toBe(2)
    // Monotonic non-overlapping frames.
    expect(spans[1].startFrame).toBeGreaterThanOrEqual(spans[0].endFrame)
  })

  it('handles a repeated token separated by a blank', () => {
    const e = [[L(0.1), L(0.8)], [L(0.8), L(0.1)], [L(0.1), L(0.8)]] // vocab {0:blank,1:'a'}
    const spans = forcedAlignCTC(e, [1, 1], 0)
    expect(spans).toHaveLength(2)
    expect(spans[0].startFrame).toBe(0)
    expect(spans[1].startFrame).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/forcedAlign/viterbi.test.ts`
Expected: FAIL — `forcedAlignCTC` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ai-pipeline/forcedAlign/viterbi.ts
export interface TokenSpan {
  tokenIndex: number // index into the target token array
  tokenId: number
  startFrame: number
  endFrame: number // inclusive
}

/**
 * CTC forced alignment (torchaudio-style). `emissions[t][v]` are LOG-probabilities
 * for frame t, vocab id v. `tokens` is the target token-id sequence (no blanks).
 * Returns the frame span each target token occupies along the single most likely
 * monotonic path. `blankId` is the CTC blank vocab id.
 */
export function forcedAlignCTC(
  emissions: readonly (readonly number[])[],
  tokens: readonly number[],
  blankId: number,
): TokenSpan[] {
  const T = emissions.length
  const N = tokens.length
  if (N === 0 || T === 0) return []
  const NEG = -Infinity
  // trellis[t][j] = best log-score having emitted tokens[0..j-1] by frame t.
  const trellis: number[][] = Array.from({ length: T + 1 }, () => new Array(N + 1).fill(NEG))
  const back: number[][] = Array.from({ length: T + 1 }, () => new Array(N + 1).fill(0)) // 0=stay(blank/repeat), 1=advance
  trellis[0][0] = 0
  for (let t = 1; t <= T; t++) {
    const em = emissions[t - 1]
    for (let j = 0; j <= N; j++) {
      // Stay: emit blank (or repeat current token) — keeps j.
      const stayEmit = j > 0 ? Math.max(em[blankId], em[tokens[j - 1]]) : em[blankId]
      const stay = trellis[t - 1][j] + stayEmit
      // Advance: emit tokens[j-1] for the first time — j-1 -> j.
      const advance = j > 0 ? trellis[t - 1][j - 1] + em[tokens[j - 1]] : NEG
      if (advance > stay) { trellis[t][j] = advance; back[t][j] = 1 }
      else { trellis[t][j] = stay; back[t][j] = 0 }
    }
  }
  // Backtrack from (T, N).
  const endFrameOf = new Array<number>(N).fill(-1)
  const startFrameOf = new Array<number>(N).fill(-1)
  let j = N
  for (let t = T; t >= 1 && j > 0; t--) {
    if (back[t][j] === 1) {
      // token j-1 was emitted (first time) at frame t-1.
      startFrameOf[j - 1] = t - 1
      if (endFrameOf[j - 1] < 0) endFrameOf[j - 1] = t - 1
      j--
    } else if (endFrameOf[j - 1] < 0 && j <= N && j > 0) {
      // still within token j-1's blank/repeat run
      endFrameOf[j - 1] = t - 1
    }
  }
  const spans: TokenSpan[] = []
  for (let k = 0; k < N; k++) {
    const start = startFrameOf[k] < 0 ? 0 : startFrameOf[k]
    const end = endFrameOf[k] < 0 ? start : endFrameOf[k]
    spans.push({ tokenIndex: k, tokenId: tokens[k], startFrame: start, endFrame: Math.max(start, end) })
  }
  return spans
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/forcedAlign/viterbi.test.ts`
Expected: PASS (2 tests). If the second (repeated-token) test fails, the stay/advance emission logic is wrong — fix `stayEmit`/`advance` before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/forcedAlign/viterbi.ts tests/ai-pipeline/forcedAlign/viterbi.test.ts
git commit --no-gpg-sign -m "feat(align): CTC forced-alignment Viterbi core (pure)"
```

---

## Task 3: Line text → model-vocab token sequence (pure)

**Goal:** Convert a line to the CTC model's token-id sequence. EN: lowercase, map characters via the model's `label2id`. JA: `toRomaji` then the same char mapping. Unknown chars are dropped. This is the piece that lets us feed *known* lyrics to Viterbi.

**Files:**
- Create: `src/ai-pipeline/forcedAlign/normalize.ts`
- Test: `tests/ai-pipeline/forcedAlign/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { lineToTokenIds } from '../../../src/ai-pipeline/forcedAlign/normalize'

// A tiny wav2vec2-style char vocab. '|' is the word separator; <pad> is blank.
const label2id: Record<string, number> = { '<pad>': 0, '|': 1, a: 2, b: 3, o: 4, z: 5, r: 6 }

describe('lineToTokenIds', () => {
  it('maps EN characters to ids, spaces to the word separator, drops unknowns', () => {
    const ids = lineToTokenIds('ab z!', 'en', label2id, { wordSep: '|' })
    expect(ids).toEqual([2, 3, 1, 5]) // a b | z  (space -> '|', '!' dropped)
  })

  it('romanizes JA before mapping (async romanizer injected)', async () => {
    const romanize = async () => 'aozora'
    const ids = await import('../../../src/ai-pipeline/forcedAlign/normalize')
      .then((m) => m.lineToTokenIdsJa('青空', label2id, { wordSep: '|', romanize }))
    expect(ids).toEqual([2, 4, 5, 4, 6, 2]) // a o z o r a
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/forcedAlign/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ai-pipeline/forcedAlign/normalize.ts
export interface NormalizeOpts {
  wordSep: string // the model's word-boundary token, e.g. '|'
}

/** Map already-latin text to vocab ids: lowercase, spaces -> wordSep, drop unknowns. */
export function lineToTokenIds(
  text: string,
  _lang: 'en' | 'ja',
  label2id: Record<string, number>,
  opts: NormalizeOpts,
): number[] {
  const ids: number[] = []
  for (const ch of text.toLowerCase()) {
    if (/\s/.test(ch)) { if (label2id[opts.wordSep] != null) ids.push(label2id[opts.wordSep]); continue }
    const id = label2id[ch]
    if (id != null) ids.push(id)
  }
  return ids
}

/** JA path: romanize (injected, async — the app's toRomaji) then map like latin. */
export async function lineToTokenIdsJa(
  text: string,
  label2id: Record<string, number>,
  opts: NormalizeOpts & { romanize: (t: string) => Promise<string> },
): Promise<number[]> {
  const romaji = await opts.romanize(text)
  return lineToTokenIds(romaji, 'en', label2id, opts)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/forcedAlign/normalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/forcedAlign/normalize.ts tests/ai-pipeline/forcedAlign/normalize.test.ts
git commit --no-gpg-sign -m "feat(align): line-text to CTC-vocab token normalizer (pure, EN + JA-romaji)"
```

---

## Task 4: `forceAlignLines` core (model-backed)

**Goal:** Wire the model emissions + normalize + Viterbi into the spec's interface: known lines + audio → per-line start/end seconds + score. Uses the model chosen in Task 1. Not unit-tested with a real model (that is the harness in Task 5); tested indirectly there.

**Files:**
- Create: `src/ai-pipeline/forcedAlign/forcedAligner.ts`

- [ ] **Step 1: Implement the module**

Use the model id confirmed in Task 1 as `CTC_MODEL`. Frame→seconds factor = `audioSeconds / T` (wav2vec2 base ≈ 20ms/frame; derive from `T` and audio length rather than hard-coding).

```ts
// src/ai-pipeline/forcedAlign/forcedAligner.ts
import { AutoModelForCTC, AutoProcessor } from '@huggingface/transformers'
import { forcedAlignCTC } from './viterbi'
import { lineToTokenIds, lineToTokenIdsJa } from './normalize'

const CTC_MODEL = '<MODEL FROM TASK 1>' // e.g. 'Xenova/mms-300m'

export interface ForcedLineTiming { start: number; end: number; score: number }
export interface ForceAlignInput { text: string; lang: 'ja' | 'en' }

let processorP: Promise<unknown> | null = null
let modelP: Promise<unknown> | null = null

export async function forceAlignLines(
  audio16k: Float32Array, // MUST be 16kHz mono
  sampleRate: number,
  lines: ForceAlignInput[],
  deps: { romanize: (t: string) => Promise<string> },
): Promise<{ lineTimings: ForcedLineTiming[] }> {
  if (sampleRate !== 16000) throw new Error(`forceAlignLines expects 16kHz, got ${sampleRate}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processor: any = await (processorP ??= AutoProcessor.from_pretrained(CTC_MODEL) as Promise<unknown>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = await (modelP ??= AutoModelForCTC.from_pretrained(CTC_MODEL) as Promise<unknown>)

  const inputs = await processor(audio16k)
  const out = await model(inputs)
  const dims: number[] = out.logits.dims // [1, T, V]
  const T = dims[1]
  const V = dims[2]
  const flat: Float32Array = out.logits.data
  // Reshape to T x V log-softmax rows.
  const emissions: number[][] = new Array(T)
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(V)
    let max = -Infinity
    for (let v = 0; v < V; v++) { const x = flat[t * V + v]; row[v] = x; if (x > max) max = x }
    let sum = 0
    for (let v = 0; v < V; v++) { const e = Math.exp(row[v] - max); row[v] = e; sum += e }
    for (let v = 0; v < V; v++) row[v] = Math.log(row[v] / sum)
    emissions[t] = row
  }

  const label2id: Record<string, number> = buildLabel2Id(model.config)
  const wordSep = pickWordSep(label2id)      // '|' for wav2vec2, ' ' for some
  const blankId = pickBlankId(label2id)      // '<pad>' / '[PAD]' / 0

  // Concatenate all lines into one token stream, tracking each line's token range.
  const lineRanges: { startTok: number; endTok: number }[] = []
  const tokens: number[] = []
  for (const line of lines) {
    const ids = line.lang === 'ja'
      ? await lineToTokenIdsJa(line.text, label2id, { wordSep, romanize: deps.romanize })
      : lineToTokenIds(line.text, 'en', label2id, { wordSep })
    const startTok = tokens.length
    tokens.push(...ids)
    lineRanges.push({ startTok, endTok: tokens.length }) // [startTok, endTok)
    if (label2id[wordSep] != null) tokens.push(label2id[wordSep]) // line boundary
  }

  const spans = forcedAlignCTC(emissions, tokens, blankId)
  const secPerFrame = (audio16k.length / 16000) / T

  const lineTimings: ForcedLineTiming[] = lineRanges.map(({ startTok, endTok }) => {
    const inLine = spans.filter((s) => s.tokenIndex >= startTok && s.tokenIndex < endTok)
    if (inLine.length === 0) return { start: 0, end: 0, score: 0 }
    const start = inLine[0].startFrame * secPerFrame
    const end = (inLine[inLine.length - 1].endFrame + 1) * secPerFrame
    return { start, end, score: inLine.length / Math.max(1, endTok - startTok) }
  })
  return { lineTimings }
}

function buildLabel2Id(config: { id2label?: Record<string, string> }): Record<string, number> {
  const out: Record<string, number> = {}
  const id2label = config.id2label ?? {}
  for (const [id, label] of Object.entries(id2label)) out[label] = Number(id)
  return out
}
function pickWordSep(l2i: Record<string, number>): string {
  return l2i['|'] != null ? '|' : (l2i[' '] != null ? ' ' : '|')
}
function pickBlankId(l2i: Record<string, number>): number {
  return l2i['<pad>'] ?? l2i['[PAD]'] ?? l2i['<blank>'] ?? 0
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b 2>&1 | tail -3`
Expected: exit 0. (Replace `<MODEL FROM TASK 1>` with the real id first, or tsc still passes — it's a string.)

- [ ] **Step 3: Commit**

```bash
git add src/ai-pipeline/forcedAlign/forcedAligner.ts
git commit --no-gpg-sign -m "feat(align): forceAlignLines core (CTC model + normalize + Viterbi)"
```

---

## Task 5: Bake-off harness + decision

**Goal:** Score forced alignment against the current baseline on LRC truth (Recollect, stranger-mixed, veil) and record the verdict. This is the Phase-1 deliverable.

**Files:**
- Create: `scripts/bakeoff-forced-align.mjs`

- [ ] **Step 1: Write the harness**

```js
// scripts/bakeoff-forced-align.mjs
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIX = join(root, 'tests/ai-pipeline/fixtures')

const { decodeMp3ToMono } = await import(pathToFileURL(join(root, 'scripts/lib/nodeAudio.mjs')).href)
const { forceAlignLines } = await import(pathToFileURL(join(root, 'src/ai-pipeline/forcedAlign/forcedAligner.ts')).href)
const { toRomaji } = await import(pathToFileURL(join(root, 'src/language/japanese/phonetics.ts')).href)
const { parseLrc } = await import(pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href)

const JA = /[぀-ヿ㐀-鿿]/
const med = (xs) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0
const p90 = (xs) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 0

// mp3 paths are local (audio is not committed); pass them as args or edit here.
const SONGS = [
  { name: 'recollect', mp3: process.env.RECOLLECT_MP3, truth: join(FIX, 'lrc-truth/recollect.json') },
]

for (const s of SONGS) {
  if (!s.mp3) { console.log(`${s.name}: set ${s.name.toUpperCase()}_MP3 to the audio path — skipped`); continue }
  const lrc = parseLrc(JSON.parse(readFileSync(s.truth, 'utf8')).syncedLyrics)
  const lines = lrc.map((r) => ({ text: r.text, lang: JA.test(r.text) ? 'ja' : 'en' }))
  const truth = lrc.map((r) => r.time)

  const { data, sampleRate } = await decodeMp3ToMono(s.mp3)
  const ratio = sampleRate / 16000
  const n = Math.floor(data.length / ratio)
  const a16 = new Float32Array(n)
  for (let i = 0; i < n; i++) a16[i] = data[Math.floor(i * ratio)]

  const t0 = performance.now()
  const { lineTimings } = await forceAlignLines(a16, 16000, lines, { romanize: toRomaji })
  const ms = Math.round(performance.now() - t0)

  const diffs = lineTimings.map((lt, i) => lt.start - truth[i]).filter((x) => Number.isFinite(x))
  const offset = med(diffs)
  const errs = lineTimings.map((lt, i) => Math.abs(lt.start - (truth[i] + offset)))
  console.log(`${s.name} FORCED: p50=${med(errs).toFixed(2)}s p90=${p90(errs).toFixed(2)}s over1s=${errs.filter((e) => e > 1).length}/${errs.length} (${ms}ms)`)
  console.log('  (baseline from lrc-truth.test.ts: recollect mixed p50 ~1.89s)')
}
```

- [ ] **Step 2: Run the bake-off**

Run: `RECOLLECT_MP3="/Users/ninjaruss/Downloads/re-zero-season-4-opening-full-recollect-by-konomi-suzuki-feat-ashnikko-lyrics-128-ytshorts.savetube.me.mp3" npx tsx scripts/bakeoff-forced-align.mjs 2>&1 | grep -viE "onnxruntime|dtype|warning"`
Expected: a `recollect FORCED: p50=... p90=... over1s=...` line. Compare p50 to the baseline 1.89s.

- [ ] **Step 3: Record the verdict (Recollect is the primary datapoint)**

Only Recollect's audio is available locally (stranger/veil ship transcripts, not audio — for size/copyright). So Recollect is the offline bake-off. That is acceptable: Recollect *is* the target hard case, and veil regression is not a real risk here — forced alignment only fires on low-confidence songs (veil is high-confidence and would never trigger it), and veil's transcribe-then-match path is already locked by its LRC gate. Optionally, if the user provides stranger/veil mp3s, add `{ name, mp3: process.env.<NAME>_MP3, truth }` entries and re-run.

In the spec's "Phase 1 spike result" note, append the decision table (forced vs baseline p50/p90/over1s for Recollect, plus any provided songs) and the **GO/NO-GO for Phase 2**:
- GO if forced clearly beats the Recollect baseline (1.89s → target p50 ≤ ~0.8s).
- NO-GO otherwise — record why (e.g. JA romaji fidelity vs the sung reading, model frame resolution, romanization mismatches), and whether approach B is worth a separate spike.

- [ ] **Step 4: Commit**

```bash
git add scripts/bakeoff-forced-align.mjs docs/superpowers/specs/2026-07-22-forced-alignment-design.md
git commit --no-gpg-sign -m "feat(align): forced-alignment bake-off harness + Phase 1 verdict"
```

---

## Phase 1 Done

Deliverable: the forced-aligner core (`viterbi` + `normalize` + `forcedAligner`), unit-tested where pure, and a **measured GO/NO-GO** recorded in the spec. If GO, write the Phase 2 (app integration) plan — worker, `AutoAlignFlow` trigger (low-confidence + full-tier + model-available), and the per-line accept-if-better splice, verified by the existing LRC-truth gates + corpus scorecard.
