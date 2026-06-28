# Content-based sung-reading alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace proportional-time token windows in the reading reconciler with content-based Needleman–Wunsch alignment of expected reading-kana against transcript kana, so genuine non-standard sung readings (術→すべ) are caught and the per-token garbage (術→ニス, 嗚呼→ナア) is eliminated.

**Architecture:** A new pure module `src/ai-pipeline/readingAlignment.ts` aligns the line's expected kana (`A`, built from dictionary readings) against the transcript kana (`B`). Matching kana act as anchors; each kanji token's sung reading is read out of its bracketed gap. `reconcileTokenReadings` keeps its signature and delegates the per-token decision to the new module. The display layer, async kanji pass, and timing are untouched.

**Tech Stack:** TypeScript, Vitest. Kana helpers from `src/language/japanese/phonetics.ts`.

---

## File structure

- **Create** `src/ai-pipeline/readingAlignment.ts` — NW aligner (`nwAlign`), expected-kana builder (`buildExpectedKana`), per-token resolver (`resolveLineReadings`). Self-contained: imports only `katakanaToHiragana` from phonetics and `Token` from core types. No dependency on `readingReconciler` (avoids an import cycle).
- **Create** `tests/ai-pipeline/readingAlignment.test.ts` — unit tests for the new module.
- **Modify** `src/ai-pipeline/readingReconciler.ts` — replace the per-token owned-word block in `reconcileTokenReadings` with a call to `resolveLineReadings`; delete now-dead helpers (`ownedWordsInWindow`, `ownedSungKanaInWindow`, and the mora-weight windowing if unused).
- **Modify** `tests/ai-pipeline/readingReconciler.test.ts` — keep existing assertions green; update only where the proportional-window behaviour is replaced.

**Shared constant note:** `readingReconciler.ts` exports `HIGH_READING_CONFIDENCE = 0.8` (imported by tests). `readingAlignment.ts` defines its own `ADOPT_MIN_CONFIDENCE = 0.8` with a comment that the two must stay equal — keeping the modules decoupled is worth the one-number duplication.

---

## Task 1: Needleman–Wunsch kana aligner

**Files:**
- Create: `src/ai-pipeline/readingAlignment.ts`
- Test: `tests/ai-pipeline/readingAlignment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { nwAlign } from '../../src/ai-pipeline/readingAlignment'

describe('nwAlign', () => {
  it('aligns identical strings as all matches', () => {
    const cols = nwAlign('あい', 'あい')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }])
  })

  it('represents a substitution as aligned mismatched columns', () => {
    // あ X う  vs  あ Y う  -> middle column is a mismatch, both indices present
    const cols = nwAlign('あいう', 'あえう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 2 }])
  })

  it('represents a deletion (extra A char) with b = -1', () => {
    const cols = nwAlign('あいう', 'あう')
    // あ match, い deleted (no B), う match
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: -1 }, { a: 2, b: 1 }])
  })

  it('represents an insertion (extra B char) with a = -1', () => {
    const cols = nwAlign('あう', 'あいう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: -1, b: 1 }, { a: 1, b: 2 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts`
Expected: FAIL — `nwAlign is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'

/** One column of a global alignment. `a`/`b` are indices into the input strings,
 * or -1 when that side is a gap. */
export interface AlignColumn { a: number; b: number }

const MATCH = 2
const MISMATCH = -1
const GAP = -1

/** Needleman–Wunsch global alignment of two kana strings. Returns the alignment
 * path as ordered columns. Matching characters dominate, so shared kana anchor the
 * frame and substitutions/indels fall into the gaps between anchors. */
export function nwAlign(A: string, B: string): AlignColumn[] {
  const n = A.length
  const m = B.length
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) score[i][0] = i * GAP
  for (let j = 1; j <= m; j++) score[0][j] = j * GAP
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? MATCH : MISMATCH)
      score[i][j] = Math.max(diag, score[i - 1][j] + GAP, score[i][j - 1] + GAP)
    }
  }
  const cols: AlignColumn[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? MATCH : MISMATCH)) {
      cols.push({ a: i - 1, b: j - 1 }); i--; j--
    } else if (i > 0 && score[i][j] === score[i - 1][j] + GAP) {
      cols.push({ a: i - 1, b: -1 }); i--
    } else {
      cols.push({ a: -1, b: j - 1 }); j--
    }
  }
  cols.reverse()
  return cols
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/readingAlignment.ts tests/ai-pipeline/readingAlignment.test.ts
git commit -m "feat(align): Needleman-Wunsch kana aligner"
```

---

## Task 2: Comparable-kana normaliser and expected-kana builder

**Files:**
- Modify: `src/ai-pipeline/readingAlignment.ts`
- Test: `tests/ai-pipeline/readingAlignment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { comparableKana, buildExpectedKana } from '../../src/ai-pipeline/readingAlignment'
import type { Token } from '../../src/core/types'

const tok = (surface: string, reading?: string): Token => ({
  surface, reading, pos: '名詞', startIndex: 0, endIndex: surface.length,
})

describe('comparableKana', () => {
  it('lowercases katakana to hiragana and drops the long mark', () => {
    expect(comparableKana('スベ')).toBe('すべ')
    expect(comparableKana('アー')).toBe('あ')
  })
})

describe('buildExpectedKana', () => {
  it('concatenates token readings and maps each kana back to its token', () => {
    const tokens = [tok('僕', 'ボク'), tok('に', 'ニ'), tok('術', 'ジュツ')]
    const { a, owner } = buildExpectedKana(tokens)
    expect(a).toBe('ぼくにじゅつ')
    // ぼ く -> token 0, に -> token 1, じ ゅ つ -> token 2
    expect(owner).toEqual([0, 0, 1, 2, 2, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts -t comparableKana`
Expected: FAIL — `comparableKana is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `readingAlignment.ts`)

```typescript
const KANJI_RE = /[㐀-鿿]/

/** Hiragana-only comparable form: katakana→hiragana, NFKC, drop the long-sound mark,
 * keep only hiragana. Mirrors readingReconciler.normalizeKanaForCompare. */
export function comparableKana(text: string): string {
  let out = ''
  for (const ch of katakanaToHiragana(text).normalize('NFKC')) {
    if (ch === 'ー') continue
    if (/[ぁ-ん]/.test(ch)) out += ch
  }
  return out
}

/** Build the line's expected kana string `a` (concatenated dictionary readings) plus
 * `owner`, mapping each kana position back to its source token index. Kana-only
 * tokens contribute their own reading; tokens with no usable kana contribute nothing. */
export function buildExpectedKana(tokens: Token[]): { a: string; owner: number[] } {
  let a = ''
  const owner: number[] = []
  tokens.forEach((t, idx) => {
    const source = t.reading ?? (KANJI_RE.test(t.surface) ? '' : t.surface)
    for (const ch of comparableKana(source)) { a += ch; owner.push(idx) }
  })
  return { a, owner }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/readingAlignment.ts tests/ai-pipeline/readingAlignment.test.ts
git commit -m "feat(align): comparable-kana normaliser and expected-kana builder"
```

---

## Task 3: Per-token resolver — verified and neutral paths

**Files:**
- Modify: `src/ai-pipeline/readingAlignment.ts`
- Test: `tests/ai-pipeline/readingAlignment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { resolveLineReadings } from '../../src/ai-pipeline/readingAlignment'

describe('resolveLineReadings — verified & neutral', () => {
  it('skips kana-only tokens', () => {
    const tokens = [tok('の', 'ノ')]
    expect(resolveLineReadings(tokens, 'の')[0].kind).toBe('skip')
  })

  it('verifies a kanji token when the transcript wrote the kanji', () => {
    const tokens = [tok('車', 'クルマ')]
    expect(resolveLineReadings(tokens, '小さな車は')[0]).toEqual({ kind: 'verified', confidence: 1 })
  })

  it('verifies when the sung kana match the dictionary reading', () => {
    const tokens = [tok('戦争', 'センソウ')]
    const d = resolveLineReadings(tokens, 'せんそう')[0]
    expect(d.kind).toBe('verified')
  })

  it('stays neutral when there is no transcript kana', () => {
    const tokens = [tok('戦争', 'センソウ')]
    expect(resolveLineReadings(tokens, '')[0].kind).toBe('neutral')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts -t resolveLineReadings`
Expected: FAIL — `resolveLineReadings is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `readingAlignment.ts`)

```typescript
/** Adoption confidence floor — keep equal to readingReconciler.HIGH_READING_CONFIDENCE. */
const ADOPT_MIN_CONFIDENCE = 0.8
/** Fraction of a token's reading kana that must match to call the dictionary confirmed. */
const VERIFY_MATCH_RATIO = 0.6
/** The REST of the line (excluding the candidate token) must align this well before a
 * sung reading is adopted — i.e. we only trust an alternate when its surrounding
 * context is solidly transcribed. */
const ADOPT_CONTEXT_FLOOR = 0.75
/** Context floor for a soft mismatch warning (weaker than adoption). */
const MISMATCH_CONTEXT_FLOOR = 0.5

export type ReadingDecisionKind = 'verified' | 'adopt' | 'mismatch' | 'neutral' | 'skip'

export interface ReadingDecision {
  kind: ReadingDecisionKind
  /** Hiragana sung reading, only for kind === 'adopt'. */
  audioReading?: string
  confidence?: number
}

function kanjiRunOf(surface: string): string {
  return [...surface].filter((ch) => KANJI_RE.test(ch)).join('')
}

export function resolveLineReadings(tokens: Token[], windowText: string): ReadingDecision[] {
  const decisions: ReadingDecision[] = tokens.map(() => ({ kind: 'skip' as ReadingDecisionKind }))
  const { a: A, owner } = buildExpectedKana(tokens)
  const B = comparableKana(windowText)

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx]
    if (!KANJI_RE.test(token.surface) || !token.reading) { decisions[idx] = { kind: 'skip' }; continue }
    const kanji = kanjiRunOf(token.surface)
    if (kanji && windowText.includes(kanji)) { decisions[idx] = { kind: 'verified', confidence: 1 }; continue }
    decisions[idx] = { kind: 'neutral' }
  }

  if (!A || !B) return decisions
  const cols = nwAlign(A, B)
  const colOfA: number[] = new Array(A.length).fill(-1)
  cols.forEach((c, k) => { if (c.a >= 0) colOfA[c.a] = k })
  let lineMatches = 0
  for (const c of cols) if (c.a >= 0 && c.b >= 0 && A[c.a] === B[c.b]) lineMatches++

  for (let idx = 0; idx < tokens.length; idx++) {
    if (decisions[idx].kind !== 'neutral') continue // skip / verified-by-kanji already set
    const token = tokens[idx]
    const aIdxs: number[] = []
    owner.forEach((o, ai) => { if (o === idx) aIdxs.push(ai) })
    if (aIdxs.length === 0) continue
    const firstCol = colOfA[aIdxs[0]]
    const lastCol = colOfA[aIdxs[aIdxs.length - 1]]

    let span = ''
    let tokMatches = 0
    for (let k = firstCol; k <= lastCol; k++) {
      const c = cols[k]
      if (c.b >= 0) span += B[c.b]
      if (c.a >= 0 && c.b >= 0 && A[c.a] === B[c.b]) tokMatches++
    }
    const R = comparableKana(token.reading!)
    const matchRatio = R.length ? tokMatches / R.length : 0
    if (matchRatio >= VERIFY_MATCH_RATIO) {
      decisions[idx] = { kind: 'verified', confidence: Math.min(1, matchRatio) }
    }
    // adoption/mismatch handled in Task 4
  }

  return decisions
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/readingAlignment.ts tests/ai-pipeline/readingAlignment.test.ts
git commit -m "feat(align): per-token resolver verified/neutral paths"
```

---

## Task 4: Adoption via anchor-bracket + line floor

**Files:**
- Modify: `src/ai-pipeline/readingAlignment.ts`
- Test: `tests/ai-pipeline/readingAlignment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('resolveLineReadings — adoption', () => {
  // 術 is sung すべ; Whisper transcribed すべ. Surrounding kana anchor the gap.
  const sube = [tok('そんな', 'ソンナ'), tok('僕', 'ボク'), tok('に', 'ニ'),
    tok('術', 'ジュツ'), tok('は', 'ハ'), tok('ない', 'ナイ'), tok('よな', 'ヨナ')]

  it('adopts a real non-standard reading bracketed by anchors (術→すべ)', () => {
    const d = resolveLineReadings(sube, 'そんな僕にすべはないよな')
    const jutsu = d[3]
    expect(jutsu.kind).toBe('adopt')
    expect(jutsu.audioReading).toBe('すべ')
    expect(jutsu.confidence!).toBeGreaterThanOrEqual(0.8)
  })

  it('adopts 理由→わけ when the rest of the line matches', () => {
    const tokens = [tok('理由', 'リユウ'), tok('も', 'モ'), tok('ない', 'ナイ'), tok('のに', 'ノニ')]
    const d = resolveLineReadings(tokens, 'わけもないのに')
    expect(d[0].kind).toBe('adopt')
    expect(d[0].audioReading).toBe('わけ')
  })

  it('stays neutral when the differing span is NOT bracketed by anchors', () => {
    // transcript bears no resemblance: no clean anchors around 術
    const d = resolveLineReadings(sube, 'まったくちがうおと')
    expect(d[3].kind).toBe('neutral')
  })

  it('stays neutral when the line is poorly aligned even if the span is clean', () => {
    // Only 術 area resembles; everything else mismatched -> context score below floor
    const d = resolveLineReadings(sube, 'かきくけこすべさしすせそたちつてと')
    expect(d[3].kind).not.toBe('adopt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts -t adoption`
Expected: FAIL — `術` resolves to `neutral` (adoption not implemented yet).

- [ ] **Step 3: Write minimal implementation**

Replace the comment `// adoption/mismatch handled in Task 4` and the lines around it in `resolveLineReadings` so the per-token tail reads:

```typescript
    const R = comparableKana(token.reading!)
    const matchRatio = R.length ? tokMatches / R.length : 0
    if (matchRatio >= VERIFY_MATCH_RATIO) {
      decisions[idx] = { kind: 'verified', confidence: Math.min(1, matchRatio) }
      continue
    }

    // Context score: how well the line aligned EXCLUDING this token's own kana. This
    // is the trust signal — a real alternate sits in an otherwise well-transcribed line.
    const contextLen = A.length - aIdxs.length
    const contextScore = contextLen > 0 ? (lineMatches - tokMatches) / contextLen : 0
    const bracketed = isAnchored(cols, firstCol, A, B, 'left') && isAnchored(cols, lastCol, A, B, 'right')
    const clean = span.length >= 2 && span !== R
    if (bracketed && clean && contextScore >= MISMATCH_CONTEXT_FLOOR) {
      const confidence = Math.round((0.5 * contextScore + 0.5) * 100) / 100
      if (contextScore >= ADOPT_CONTEXT_FLOOR && confidence >= ADOPT_MIN_CONFIDENCE) {
        decisions[idx] = { kind: 'adopt', audioReading: span, confidence }
      } else {
        decisions[idx] = { kind: 'mismatch', confidence }
      }
    }
```

Add the bracket helper (top-level in the module):

```typescript
/** A token's aligned span is anchored on a side when the adjacent column is a real
 * matched kana column (or the line edge). Anything else — a mismatch or a stray
 * insertion at the boundary — means the span's edge is untrustworthy. */
function isAnchored(cols: AlignColumn[], edgeCol: number, A: string, B: string, side: 'left' | 'right'): boolean {
  const k = side === 'left' ? edgeCol - 1 : edgeCol + 1
  if (k < 0 || k >= cols.length) return true // line edge
  const c = cols[k]
  return c.a >= 0 && c.b >= 0 && A[c.a] === B[c.b]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/readingAlignment.test.ts`
Expected: PASS. If `術→すべ` does not adopt, inspect its `contextScore` (note 僕 is dropped from `B` as kanji, so ぼく is unmatched context — score ≈ 9/11 ≈ 0.82); if needed lower `ADOPT_CONTEXT_FLOOR` toward 0.7 — but keep it high enough that the "poorly aligned" test still rejects. Re-run until both pass.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/readingAlignment.ts tests/ai-pipeline/readingAlignment.test.ts
git commit -m "feat(align): anchor-bracketed adoption with line-alignment floor"
```

---

## Task 5: Wire the resolver into `reconcileTokenReadings`

**Files:**
- Modify: `src/ai-pipeline/readingReconciler.ts`
- Test: `tests/ai-pipeline/readingReconciler.test.ts`

- [ ] **Step 1: Reconcile the existing integration tests with the new contract**

The content-based resolver only adopts/flags when surrounding kana **anchor** the token, so several existing tests that assert adoption or amber from a *single-token, context-free* line no longer apply — that was exactly the unreliable behaviour we are removing. Make these edits in `tests/ai-pipeline/readingReconciler.test.ts`:

(a) **Replace** `does not adopt a fragment sliced from a word spanning several tokens` with the real win (multi-token, anchored):

```typescript
  it('adopts a non-standard reading the transcript clearly spells (術→すべ)', () => {
    const subeLine: TimedLine = { startTime: 0, endTime: 4, original: 'そんな僕に術はないよな', translation: '' }
    const tokens = [tok('そんな', 'ソンナ', 0), tok('僕', 'ボク', 3), tok('に', 'ニ', 4),
      tok('術', 'ジュツ', 5), tok('は', 'ハ', 6), tok('ない', 'ナイ', 7), tok('よな', 'ヨナ', 9)]
    const words = [{ word: 'そんな僕にすべはないよな', startTime: 0, endTime: 4 }]
    const out = reconcileTokenReadings(tokens, subeLine, words)
    const jutsu = out.find((t) => t.surface === '術')!
    expect(jutsu.audioReading).toBe('スベ')
    expect(jutsu.readingMismatch).toBeFalsy()
  })
```

(b) **Replace** `adopts sung reading when it differs from dictionary` (the single-token 明日→あす case) with an anchored multi-token version:

```typescript
  it('adopts a sung alternate when surrounding kana anchor it', () => {
    const l: TimedLine = { startTime: 10, endTime: 14, original: '君の明日へ', translation: '' }
    const tokens = [tok('君', 'キミ', 0), tok('の', 'ノ', 1), tok('明日', 'アシタ', 2), tok('へ', 'ヘ', 4)]
    const words = [{ word: 'きみのあすへ', startTime: 10, endTime: 14 }]
    const out = reconcileTokenReadings(tokens, l, words)
    const asu = out.find((t) => t.surface === '明日')!
    expect(asu.audioReading).toBe('アス')
    expect(asu.readingMismatch).toBeFalsy()
  })
```

(c) **Remove** the test `flags a mismatch when owned audio differs but is too uncertain to adopt` (the single-token 色/あお amber case). With content-based alignment a wholly-different single-token line has no anchors and correctly resolves to neutral; the scenario no longer exists.

(d) **Replace** the D3 test `adopts a high-confidence alternate from word-level evidence` (single-token 理由→わけ) with an anchored version:

```typescript
  it('adopts a high-confidence alternate when the line otherwise matches', () => {
    const l: TimedLine = { startTime: 0, endTime: 3, original: '理由もないのに', translation: '' }
    const tokens = [tok('理由', 'リユウ', 0), tok('も', 'モ', 2), tok('ない', 'ナイ', 3), tok('のに', 'ノニ', 5)]
    const words = [{ word: 'わけもないのに', startTime: 0, endTime: 3 }]
    const out = reconcileTokenReadings(tokens, l, words)
    expect(out[0].audioReading).toBe('ワケ')
  })
```

(e) **Keep unchanged** (they already match the new contract — verify during Step 4): `verifies dictionary reading when audio matches`, `verifies a later token when its audio window matches`, `stays neutral when audio evidence is a single stray mora`, `ignores kana-only tokens`, `keeps the dictionary reading when only a phrase-level segment covers 理由` (asserts only `audioReading` undefined), the 車 kanji-spelled test, `keeps a noisy segment-mode 戦争 slice below the ruby threshold`, and `marks a token verified (confidence 1) when audio matches the dictionary`. The `isReliableTranscriptWindow` / `readingAdoptionConfidence` describe blocks test helpers still used by `reconcileTokenReadingsAsync`, so leave them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/readingReconciler.test.ts -t '術'`
Expected: FAIL — old proportional path returns `ニス`/undefined for 術.

- [ ] **Step 3: Rewrite the per-token body of `reconcileTokenReadings`**

In `src/ai-pipeline/readingReconciler.ts`:

(a) Add the import near the top:

```typescript
import { resolveLineReadings } from './readingAlignment'
```

(b) Replace the entire `reconcileTokenReadings` function body (the proportional-window `tokens.map(...)`) with:

```typescript
export function reconcileTokenReadings(
  tokens: Token[],
  line: TimedLine,
  transcriptWords: TimedTranscriptWord[],
): Token[] {
  if (tokens.length === 0) return tokens
  const windowWords = wordsInLineWindow(transcriptWords, line)
  if (windowWords.length === 0) return tokens
  const windowText = windowWords.map((w) => w.word).join('')

  const decisions = resolveLineReadings(tokens, windowText)
  return tokens.map((token, i) => {
    const d = decisions[i]
    switch (d.kind) {
      case 'verified':
        return { ...token, readingVerified: true, readingMismatch: false, readingConfidence: d.confidence ?? 1 }
      case 'adopt':
        return {
          ...token,
          audioReading: hiraganaToKatakana(d.audioReading!),
          readingVerified: false,
          readingMismatch: false,
          readingConfidence: d.confidence,
        }
      case 'mismatch':
        return { ...token, readingMismatch: true, readingVerified: false, readingConfidence: d.confidence }
      case 'neutral':
        return { ...token, readingMismatch: false, readingVerified: false }
      default: // 'skip' — kana-only or unreadable: leave untouched
        return token
    }
  })
}
```

(c) Delete the now-unused helpers and constants in `readingReconciler.ts`: `ownedWordsInWindow`, `ownedSungKanaInWindow`, `WORD_OWNED_MIN_FRACTION`, `sungMoraCap`, `transcriptSliceForWindow`'s `'kana'` path if unused, `transcriptKanjiCovers` (now handled in the resolver), and the `lineStart`/`lineEnd`/`tokenMoraWeight`-based windowing that only `reconcileTokenReadings` used. Keep anything still referenced by `reconcileTokenReadingsAsync` (e.g. `tokenMoraWeight`, `coveringWords`, `sungGlyphsInWindow`, `timingOverlapFraction`, `adoptReadingFromTranscriptKanji`). Run `npx tsc --noEmit` and remove exactly what it reports as unused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/readingReconciler.test.ts && npx tsc --noEmit`
Expected: all reconciler tests PASS, typecheck clean. If a pre-existing test asserted old proportional behaviour (e.g. the coarse 戦争 D3 confidence test), confirm the new path still satisfies it (戦争↔せんそう verifies; a coarse non-matching chunk yields neutral, so `readingConfidence ?? 0` stays below `HIGH_READING_CONFIDENCE`). Adjust only assertions that encoded the removed proportional mechanism, not the user-facing guarantees.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/readingReconciler.ts tests/ai-pipeline/readingReconciler.test.ts
git commit -m "feat(align): reconcile readings via content-based alignment"
```

---

## Task 6: Full-fixture validation and threshold tuning

**Files:**
- Create (throwaway): `tests/ai-pipeline/_validate.test.ts`

- [ ] **Step 1: Add the throwaway harness**

```typescript
import { describe, it } from 'vitest'
import { readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import kuromoji from 'kuromoji'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import type { Token } from '../../src/core/types'
import { reconcileTokenReadings, hasKanji, wordsInLineWindow } from '../../src/ai-pipeline/readingReconciler'

const here = dirname(fileURLToPath(import.meta.url))
const DICT = join(here, '../../node_modules/kuromoji/dict')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')
let _t: any
const getTok = (): Promise<any> => _t ? Promise.resolve(_t)
  : new Promise((res, rej) => kuromoji.builder({ dicPath: DICT }).build((e: any, t: any) => e ? rej(e) : (_t = t, res(t))))
async function tokenize(text: string): Promise<Token[]> {
  const t = await getTok()
  return t.tokenize(text).map((m: any, i: number) => ({
    surface: m.surface_form, reading: m.reading && m.reading !== '*' ? m.reading : undefined,
    pos: m.pos, startIndex: i, endIndex: i + 1,
  }))
}
function loadWords(name: string) {
  return sanitizeTranscript(JSON.parse(readFileSync(join(here, `../../.cache/auto-align-audit/${name}`), 'utf8')).chunks.flatMap((c: any) => {
    const [s, e] = c.timestamp ?? []; const w = c.text?.trim()
    return (!w || !Number.isFinite(s)) ? [] : [{ word: w, startTime: s, endTime: e }]
  }))
}
async function run(cache: string) {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = loadWords(cache)
  const { lines } = alignLyrics(lineTexts, words, undefined, 'ja')
  let out = `\n##### ${cache} #####\n`
  let adopted = 0
  for (const line of lines) {
    const recon = reconcileTokenReadings(await tokenize(line.original), line, words)
    const win = wordsInLineWindow(words, line).map((w: any) => w.word).join('')
    for (const t of recon) {
      if (!hasKanji(t.surface) || !t.reading) continue
      if (t.audioReading) { adopted++; out += `  ADOPT ${t.surface}「${t.reading}」→${t.audioReading} lyric="${line.original}" win="${win.slice(0,40)}"\n` }
    }
  }
  out += `  TOTAL adopted=${adopted}\n`
  appendFileSync('/tmp/validate.txt', out)
}
describe('validate', () => {
  it('seg', async () => { await run('AKFG_FirstTake_segment.json') })
  it('word', async () => { await run('AKFG_FirstTake_word.json') })
})
```

- [ ] **Step 2: Run the harness and inspect**

Run: `rm -f /tmp/validate.txt && npx vitest run tests/ai-pipeline/_validate.test.ts >/dev/null 2>&1; cat /tmp/validate.txt`
Expected target: every `ADOPT` line is a *real* non-standard reading (e.g. 術→すべ, 理由→わけ); **none of** the validated garbage (逸れ→レタ/ニス, 嗚呼→ナア, 心→ミモ, 絡まっ→ッテル) appears.

- [ ] **Step 3: Tune if needed**

If any garbage still adopts, raise `ADOPT_CONTEXT_FLOOR` (e.g. 0.75 → 0.8) in `readingAlignment.ts`. If a real reading (術/理由) is missed, lower it slightly. Re-run Step 2 and the unit tests (`npx vitest run tests/ai-pipeline/readingAlignment.test.ts`) until both the unit acceptance set and the harness target hold simultaneously.

- [ ] **Step 4: Remove the harness**

```bash
rm tests/ai-pipeline/_validate.test.ts /tmp/validate.txt
```

- [ ] **Step 5: Commit any tuning**

```bash
git add src/ai-pipeline/readingAlignment.ts
git commit -m "tune(align): thresholds validated against AKFG fixtures" --allow-empty
```

---

## Task 7: Full regression and typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the reading + lyrics suites**

Run: `npx vitest run tests/ai-pipeline tests/lyrics && npx tsc --noEmit`
Expected: PASS except the 3 pre-existing `phraseAlignment.test.ts` failures already present on this branch's pre-existing working-tree edits (unrelated to readings — confirm they match the same 3 names: "uses sung layout when sheet rows merge", "anchors the bridge line", "anchors the second-chorus 何をなくした merge"). Any NEW failure must be fixed before proceeding.

- [ ] **Step 2: Commit (if any incidental fixes were needed)**

```bash
git add -A && git commit -m "test(align): green reading suites after content-based rewrite" --allow-empty
```

---

## Self-review notes

- **Spec coverage:** Task 1 = NW aligner; Task 2 = A/B build; Task 3 = verified/neutral paths + lineMatches; Task 4 = anchor-bracket adoption + per-token context floor + amber; Task 5 = wiring + flag mapping + dead-code removal + existing-test reconciliation; Task 6 = acceptance set #1–#6 via harness + tuning; Task 7 = regression. All spec sections covered.
- **Context vs global score:** the spec's `lineAnchorScore` is implemented as a per-token **context score** (line match excluding the candidate token), which is the more robust form of the same "is the rest of the line trustworthy?" idea — it avoids the candidate token's own length skewing the gate. Noted here so the spec and plan don't read as contradictory.
- **Type consistency:** `AlignColumn`, `ReadingDecision`/`ReadingDecisionKind`, `nwAlign`, `buildExpectedKana`, `comparableKana`, `resolveLineReadings`, `isAnchored` are named identically across tasks. `hiraganaToKatakana` already exists in `readingReconciler.ts` (used by the adopt branch).
- **No placeholders:** every code step shows full code; tuning steps give concrete directions and target numbers.
