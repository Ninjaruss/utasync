# Repeat-Chorus Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repeated chorus lines (including near-identical ad-lib variants and 2-occurrence repeats) anchor to their own sung occurrence, and un-scoreable vocalization lines stop counting as needs_review — dropping Stranger than Heaven from 27/59 flagged lines toward the corpus median.

**Architecture:** Three localized changes, no core-LCS edits: (1) fuzzy repeat detection in `findRepeatedStanzas` (ad-libs stripped, ≥0.85 char-similarity), (2) the blanket 2-occurrence skip in `realignRepeatedStanzaOccurrences` becomes an evidence gate (accept a re-anchor only when it scores strictly better than the current placement), (3) `isInterjectionLyricLine` gains an EN-vocalization branch so those lines classify as `approximate`/interpolated, plus an informational `unscoreable` scorecard column. Everything is protected by the boundary baseline locked in PR #3 — any counter increase on the other 7 corpus entries fails CI.

**Tech Stack:** TypeScript, vitest, tsx; committed fixtures in `tests/ai-pipeline/fixtures/` (no audio needed).

**Spec:** `docs/superpowers/specs/2026-07-07-repeat-chorus-matching-design.md`
**Evidence:** `docs/superpowers/2026-07-line-boundary-findings.md` §5

**Key background:**
- `findRepeatedStanzas` / `realignRepeatedStanzaOccurrences` live in `src/lyrics/repeatedStanzaAlignment.ts` (474 lines). The re-anchor runs inside pass 2 (`refineAlignmentWithPhrases`, `src/lyrics/phraseAlignment.ts`). Motivating tests: `tests/lyrics/repeatedStanzaAlignment.test.ts` — must stay green.
- Stranger fixtures: `tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt` (59 lines) + `transcript.word.json` / `transcript.segment.json` ({chunks} format). Chorus family: lines starting "I found a place where I'm not alone" appear at sheet rows 0, 14, 31, 52 (0-based; row 52's block has ad-lib variants). Bridge "Paved my way, won't live in my past" appears at rows 43 and 47 (exactly twice). Interjections are rows 38–42.
- Current stranger scorecard: `align_needs_review` 27 (word) / 20 (segment). Corpus median ≈ 2. Veil (the 2-occurrence-skip's motivating song) currently has `align_needs_review` 7 — it must not exceed 7 after these changes.
- Run tests: `npx vitest run tests/lyrics/repeatedStanzaAlignment.test.ts --reporter=dot`. Scorecard: `npx tsx scripts/audit-corpus.mjs` (+ `--check-baseline`).
- Repo policy: commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; stage only the files you touched.

---

### Task 1: Fuzzy repeat detection

**Files:**
- Modify: `src/lyrics/repeatedStanzaAlignment.ts` (`stanzaKey` + `findRepeatedStanzas`, lines ~14–65)
- Test: `tests/lyrics/repeatedStanzaAlignment.test.ts` (extend)

- [ ] **Step 1: Write the failing tests.** Append to `tests/lyrics/repeatedStanzaAlignment.test.ts` (match its existing import style — it already imports `findRepeatedStanzas`):

```ts
describe('findRepeatedStanzas — fuzzy variants', () => {
  it('groups a chorus whose repeat differs only by parenthetical ad-libs', () => {
    const sheet = [
      'I found a place that I can call home',
      'Tested my fate, took all my pain and made a weapon',
      'Stranger than heaven',
      'bridge line one',
      'bridge line two',
      'I found a place that I can call home (Ah)',
      'Tested my fate (Tested my fate), took all my pain and made a weapon',
      'Stranger than heaven',
    ]
    const stanzas = findRepeatedStanzas(sheet)
    const chorus = stanzas.find((s) => s.occurrences.includes(0))
    expect(chorus).toBeDefined()
    expect(chorus!.occurrences).toEqual([0, 5])
    expect(chorus!.lines.length).toBe(3)
  })

  it('does not group genuinely different lines', () => {
    const sheet = [
      'I found a place that I can call home',
      'a completely different lyric line here',
      'I found a place that I can call home',
      'nothing like the second line at all',
    ]
    const stanzas = findRepeatedStanzas(sheet)
    // Only the identical single line repeats; the 2-line block must NOT match.
    for (const s of stanzas) expect(s.lines.length).toBe(1)
  })

  it('keeps verbatim detection unchanged', () => {
    const sheet = ['la la la', 'chorus a', 'chorus b', 'verse', 'chorus a', 'chorus b']
    const stanzas = findRepeatedStanzas(sheet)
    const block = stanzas.find((s) => s.lines.length === 2)
    expect(block?.occurrences).toEqual([1, 4])
  })
})
```

- [ ] **Step 2: Run to verify the first test fails** (`(Ah)` variant currently produces a different key):
`npx vitest run tests/lyrics/repeatedStanzaAlignment.test.ts --reporter=dot` — expect the ad-lib test FAIL, others may pass.

- [ ] **Step 3: Implement.** In `src/lyrics/repeatedStanzaAlignment.ts`, add below `stanzaKey`:

```ts
// Ad-libs — "(Ah)", "(Tested my fate)", "（…）" — vary across chorus repeats
// (stranger-than-heaven final chorus) without changing which occurrence a line
// belongs to. Strip them before repeat comparison.
const AD_LIB_RE = /[（(][^）)]*[）)]/g
function strippedForRepeat(text: string): string {
  return normalizeForMatch(text.replace(AD_LIB_RE, ' '))
}

function charLcsLen(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m || !n) return 0
  let prev = new Uint16Array(n + 1)
  let row = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
    ;[prev, row] = [row, prev]
  }
  return prev[n]
}

/** Near-identical after ad-lib stripping (final-chorus "、oh" tails etc.). */
const REPEAT_LINE_SIMILARITY = 0.85
function linesSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return charLcsLen(a, b) / Math.max(a.length, b.length) >= REPEAT_LINE_SIMILARITY
}
```

Then rework `findRepeatedStanzas`'s occurrence scan. Replace the body of the inner occurrence loop (`for (let i = 0; i <= lineTexts.length - len; i++) { if (stanzaKey(...) === key) occ.push(i) }`) with a fuzzy block comparison, and take the stanza's reference lines from the FIRST occurrence:

```ts
export function findRepeatedStanzas(lineTexts: readonly string[]): RepeatedStanza[] {
  const maxLen = Math.min(6, lineTexts.length)
  const stripped = lineTexts.map((t) => strippedForRepeat(t))
  const byKey = new Map<string, { lines: string[]; occurrences: number[] }>()

  const blocksSimilar = (a: number, b: number, len: number): boolean => {
    for (let k = 0; k < len; k++) {
      if (!linesSimilar(stripped[a + k], stripped[b + k])) return false
    }
    return true
  }

  for (let len = maxLen; len >= 1; len--) {
    for (let start = 0; start <= lineTexts.length - len; start++) {
      const key = stanzaKey(lineTexts, start, len)
      if (byKey.has(key)) continue
      const occ: number[] = []
      for (let i = 0; i <= lineTexts.length - len; i++) {
        if (blocksSimilar(i, start, len)) occ.push(i)
      }
      if (occ.length >= 2) {
        byKey.set(key, {
          lines: lineTexts.slice(occ[0], occ[0] + len),
          occurrences: occ,
        })
      }
    }
  }
  // ... keep the existing sort + overlap-dedupe tail of the function unchanged
```

Note: fuzzy matching means a variant block scanned later produces the same occurrence set under a different key; the existing earliest-first sort + `used`-overlap filter already dedupes that — do not change that tail. Overlapping occurrences of the same block (e.g. `occ` containing overlapping windows for repetition-heavy sheets) were impossible with exact keys and remain effectively impossible at 0.85 similarity, but the downstream `used` filter also guards it.

- [ ] **Step 4: Run to verify all pass** — the same vitest command; the WHOLE file (existing tests included) must pass.

- [ ] **Step 5: Corpus guard:** `npx tsx scripts/audit-corpus.mjs --check-baseline` → "✓ No regressions vs baseline." (Fuzzy detection alone may already shift stanza grouping; if ANY counter regresses, stop and reassess the similarity threshold before committing.)

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/repeatedStanzaAlignment.ts tests/lyrics/repeatedStanzaAlignment.test.ts
git commit -m "feat(align): fuzzy repeat-stanza detection tolerates ad-lib variants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Evidence-gated 2-occurrence re-anchor

**Files:**
- Modify: `src/lyrics/repeatedStanzaAlignment.ts` (`realignRepeatedStanzaOccurrences`, lines ~152–265)
- Test: `tests/lyrics/repeatedStanzaAlignment.twoOccurrence.test.ts` (create)

- [ ] **Step 1: Write the failing test** (`tests/lyrics/repeatedStanzaAlignment.twoOccurrence.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '../ai-pipeline/fixtures')

function loadChunks(p: string) {
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  const arr = Array.isArray(raw) ? raw : null
  if (arr) {
    return arr.flatMap((w: { word?: string; startTime?: number; endTime?: number }) => {
      const word = (w.word ?? '').trim()
      if (!word || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) return []
      return [{ word, startTime: w.startTime!, endTime: w.endTime! }]
    })
  }
  return (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start, endTime: end }]
  })
}

function loadLines(p: string) {
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

function refine(lyrics: string, transcript: string) {
  const lineTexts = loadLines(join(FIXTURES, lyrics))
  const words = loadChunks(join(FIXTURES, transcript))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return { lineTexts, refined: refineAlignmentWithPhrases(sheetRows, words, 'ja' as const) }
}

describe('two-occurrence repeat re-anchor (evidence-gated)', () => {
  it('stranger bridge repeat (rows 47-50) escapes needs_review', () => {
    const { lineTexts, refined } = refine(
      'stranger-than-heaven/lyrics.txt',
      'stranger-than-heaven/transcript.word.json',
    )
    const first = lineTexts.indexOf('Paved my way, won\'t live in my past')
    const second = lineTexts.indexOf('Paved my way, won\'t live in my past', first + 1)
    expect(second).toBeGreaterThan(first)
    const quality = refined.lineAlignmentQuality ?? []
    // The repeat block must anchor to its own occurrence: strictly after the
    // first block's start, and no longer flagged for review wholesale.
    expect(refined.lines[second].startTime).toBeGreaterThan(refined.lines[first].startTime)
    const flaggedInRepeat = [0, 1, 2, 3].filter((k) => quality[second + k] === 'needs_review').length
    expect(flaggedInRepeat).toBeLessThanOrEqual(1)
  })

  it('veil does not regress (its 2-occurrence verse pairs must fail the gate)', () => {
    const { refined } = refine('veil/lyrics.ja.txt', 'veil/transcript.words.json')
    const needsReview = (refined.lineAlignmentQuality ?? []).filter((q) => q === 'needs_review').length
    expect(needsReview).toBeLessThanOrEqual(7) // current locked baseline value
  })
})
```

Verify the row constants: run the test and check `first`/`second` resolve (43 and 47). If the bridge assertion turns out unachievable because the transcript garbles the second bridge beyond recognition, inspect `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.json` around the repeat's expected time region and, only with that evidence, relax `flaggedInRepeat` to `<= 2` and note it in the commit message.

- [ ] **Step 2: Run to verify the stranger test fails** (veil test should pass already):
`npx vitest run tests/lyrics/repeatedStanzaAlignment.twoOccurrence.test.ts --reporter=dot`

- [ ] **Step 3: Implement.** In `realignRepeatedStanzaOccurrences`:

(a) Add a helper above the function (imports `qualityRank` — extend the existing import from `'../ai-pipeline/contentAligner'`):

```ts
/** Sum of per-line quality ranks over a block, scored against local windows. */
function blockQualityScore(
  out: TimedLine[],
  blockStart: number,
  blockLen: number,
  clean: TranscriptWord[],
  sourceLanguage: Language,
): number {
  let score = 0
  for (let k = 0; k < blockLen; k++) {
    const li = blockStart + k
    const localWords = clean.filter(
      (w) => w.endTime > out[li].startTime - 3 && w.startTime < out[li].endTime + 6,
    )
    score += qualityRank(scoreLineAlignment(out[li].original, localWords, sourceLanguage).quality)
  }
  return score
}
```

(b) Replace the blanket skip:

```ts
    // Two-occurrence blocks are often verse pairs with divergent Whisper text on the
    // second pass (Veil post-chorus). Reserve block re-anchor for 3+ chorus repeats.
    if (stanza.occurrences.length < 3) continue
```

with:

```ts
    // Two-occurrence blocks are often verse pairs with divergent Whisper text on
    // the second pass (Veil post-chorus) — but real 2x choruses exist (stranger
    // bridge). Instead of skipping wholesale, re-anchor speculatively and keep
    // the result only when it scores strictly better than the current placement.
    const gated = stanza.occurrences.length === 2
```

(c) Inside the per-occurrence loop (`for (let o = 1; ...)`), snapshot before mutating — insert right after `const blockStart = stanza.occurrences[o]`:

```ts
      const beforeBlock = gated
        ? out.slice(blockStart, blockStart + blockLen).map((l) => ({ ...l }))
        : null
      const beforeScore = gated
        ? blockQualityScore(out, blockStart, blockLen, clean, sourceLanguage)
        : 0
      const searchFromBefore = searchFrom
```

(d) At the END of the per-occurrence loop body, after `enforceBlockMonotonic(out, blockStart, blockLen)` and before `searchFrom = ...`, insert the gate:

```ts
      if (beforeBlock) {
        const afterScore = blockQualityScore(out, blockStart, blockLen, clean, sourceLanguage)
        if (afterScore <= beforeScore) {
          for (let k = 0; k < blockLen; k++) out[blockStart + k] = beforeBlock[k]
          searchFrom = Math.max(searchFromBefore, out[blockStart + blockLen - 1].endTime)
          continue
        }
      }
```

(read the loop's tail first — `searchFrom` is currently assigned right after `enforceBlockMonotonic`; the `continue` must skip only that assignment, which the restored `searchFrom` line replicates. Adjust placement to the actual code shape.)

- [ ] **Step 4: Run the new test file AND the motivating tests:**
`npx vitest run tests/lyrics --reporter=dot` — all pass.

- [ ] **Step 5: Corpus guard:** `npx tsx scripts/audit-corpus.mjs` — stranger `align_needs_review` should drop; NO other song's numeric counters increase (compare veil=7, my-eyes=2, akfg=0/0, guitar=2/2 and all `bnd_*`). Then `--check-baseline` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/repeatedStanzaAlignment.ts tests/lyrics/repeatedStanzaAlignment.twoOccurrence.test.ts
git commit -m "feat(align): evidence-gated re-anchor for 2-occurrence repeats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: EN-vocalization interjection carve-out

**Files:**
- Modify: `src/ai-pipeline/contentAligner.ts` (`isInterjectionLyricLine`, lines ~60–70)
- Modify: `src/lyrics/phraseAlignment.ts` (quality upgrade block, ~line 1585)
- Test: `tests/ai-pipeline/interjectionLines.test.ts` (create)

- [ ] **Step 1: Write the failing tests** (`tests/ai-pipeline/interjectionLines.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInterjectionLyricLine } from '../../src/ai-pipeline/contentAligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const FIX = join(here, 'fixtures/stranger-than-heaven')

describe('isInterjectionLyricLine — EN vocalizations', () => {
  it.each([
    'Ahh, ooh-hmm, yeah-yeah',
    'Ooh-ooh (Oh)',
    'Oh, yeah (Hey)',
    'Yeah-yeah, ayy, yeah-yeah (Hey)',
    '(Hey) Oh, alright',
  ])('classifies %s as interjection', (line) => {
    expect(isInterjectionLyricLine(line)).toBe(true)
  })

  it.each([
    'Back streets, walking on the edge of the night',
    'I found a place where I\'m not alone',
    'Oh what a night it was', // real words beyond vocalizations
    '嗚呼...',                  // JA branch unchanged
  ])('does not misclassify %s', (line) => {
    expect(isInterjectionLyricLine(line)).toBe(line === '嗚呼...')
  })
})

describe('interjection lines are un-scoreable, not needs_review', () => {
  it('stranger interlude rows 38-42 classify approximate after refine', () => {
    const lineTexts = readFileSync(join(FIX, 'lyrics.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
    const raw = JSON.parse(readFileSync(join(FIX, 'transcript.word.json'), 'utf8'))
    const words = (raw.chunks ?? []).flatMap((c: { text?: string; timestamp?: number[] }) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
      return [{ word, startTime: start, endTime: end }]
    })
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const quality = refined.lineAlignmentQuality ?? []
    const interjRows = lineTexts
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => isInterjectionLyricLine(t))
      .map(({ i }) => i)
    expect(interjRows.length).toBe(5)
    for (const i of interjRows) {
      expect(quality[i], `row ${i} "${lineTexts[i]}"`).not.toBe('needs_review')
    }
  })
})
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/ai-pipeline/interjectionLines.test.ts --reporter=dot` — the EN classification cases FAIL.

- [ ] **Step 3: Implement the predicate branch.** In `src/ai-pipeline/contentAligner.ts`, extend `isInterjectionLyricLine`:

```ts
// EN vocalization tokens (elongation-tolerant): ahh/ooh/hmm/yeah/hey/ayy/woah/
// la/na/uh/mm/oh + "alright". A line made ENTIRELY of these (after stripping
// parenthetical ad-libs and punctuation) has no stable phonetic content for the
// JA Whisper model to transcribe — treat it like a JA interjection line:
// interpolated timing, approximate quality, excluded from match metrics.
const EN_VOCALIZATION_TOKEN = /^(a+h*|o+h*|o+o+h*|h*m+|ye+a*h*|he+y+|a+y+|w+h?o+a+h*|la+|na+|u+h*|alright)$/i

export function isInterjectionLyricLine(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (INTERJECTION_RE.test(t)) return true
  const glyphs = t.replace(/[….\s]/g, '')
  // Repeated single mora (ああ) — not real two-kana words like ねこ or そら.
  if (glyphs.length === 2 && glyphs[0] === glyphs[1] && JA_SCRIPT.test(t)) return true
  // EN vocalization-only lines ("Ahh, ooh-hmm, yeah-yeah", "(Hey) Oh, alright").
  const enTokens = t
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[\s,\-–—]+/)
    .filter(Boolean)
  return enTokens.length > 0 && enTokens.every((tok) => EN_VOCALIZATION_TOKEN.test(tok))
}
```

CAUTION: this predicate is used elsewhere (`interjection` anchor source in `alignByContent`, `recoverInterjectionTiming` in phraseAlignment). Extending it means EN vocalization lines also get interjection-style interpolated anchoring — that is the desired behavior per spec, but run the FULL suite (`npx vitest run --reporter=dot`) to confirm nothing depended on the narrower predicate. Verify the regex against each negative test case by hand: "Oh what a night it was" must fail because `what`, `night`, `was` don't match; check that `night` truly fails `he+y+` etc.

- [ ] **Step 4: Implement the quality carve-out.** In `src/lyrics/phraseAlignment.ts`, extend the existing upgrade block after the repetition-only loop (~line 1594, right before `const syncedPhrases = ...`):

```ts
  // Interjection/vocalization lines (JA 嗚呼…, EN "Ahh, ooh-hmm…") have no
  // phonetic content a JA transcript can anchor; review can't improve them.
  // They keep interpolated timing and read as approximate, not needs_review.
  for (let i = 0; i < tunedLines.length; i++) {
    if (lineAlignmentQuality[i] !== 'needs_review') continue
    if (isInterjectionLyricLine(lineTexts[i])) lineAlignmentQuality[i] = 'approximate'
  }
```

`isInterjectionLyricLine` — add to the existing `'../ai-pipeline/contentAligner'` import in phraseAlignment.ts if not present.

- [ ] **Step 5: Run the new tests (PASS) + full suite:** `npx vitest run --reporter=dot` — zero failures.

- [ ] **Step 6: Corpus guard:** `npx tsx scripts/audit-corpus.mjs` — stranger `align_needs_review` drops by ~5 more; no other numeric counter increases; `--check-baseline` clean.

- [ ] **Step 7: Commit**

```bash
git add src/ai-pipeline/contentAligner.ts src/lyrics/phraseAlignment.ts tests/ai-pipeline/interjectionLines.test.ts
git commit -m "feat(align): classify EN vocalization lines as un-scoreable interjections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `unscoreable` scorecard column

**Files:**
- Modify: `scripts/audit-corpus.mjs` (imports + scorecard row)

- [ ] **Step 1: Implement.** Add `isInterjectionLyricLine` to the existing `computeLineMatchedSpans` dynamic import from contentAligner (same destructure). In the per-song loop, after the boundary-metrics block:

```js
    // Interjection/vocalization lines are un-scoreable by design (no phonetic
    // content for the JA model) — informational string, exempt from the
    // numeric regression guard like bnd_measured.
    const unscoreable = lineTexts.filter((t) => isInterjectionLyricLine(t)).length
```

and add to the scorecard row after `align_long_dur`:

```js
      unscoreable: String(unscoreable),
```

- [ ] **Step 2: Verify:** `npx tsx scripts/audit-corpus.mjs` — stranger rows show `unscoreable 5`, all others `0`; `--check-baseline` clean (string column is exempt by design).

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-corpus.mjs
git commit -m "feat(audit): informational unscoreable-lines column

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Success-bar evaluation + baseline re-snapshot

**Files:**
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (regenerated)
- Modify: `docs/superpowers/2026-07-line-boundary-findings.md` (repeat-matching results appendix)

- [ ] **Step 1: Evaluate vs the spec bar.** Run `npx tsx scripts/audit-corpus.mjs` and record stranger's `align_needs_review` (word + segment). Target: ≤ 1.5× corpus median (~3–4). If above target, identify each remaining flagged line with per-line evidence (mirror the findings-doc §5 method: which lines, what the transcript says at the expected time). Lines whose chorus copy is genuinely garbled in the transcript are documented carve-outs (quote the transcript); lines that SHOULD match indicate a fix gap — iterate on Tasks 1–2 logic (TDD per fix, same gates) before proceeding. Do not snapshot a baseline you haven't explained.

- [ ] **Step 2: Verify zero regressions elsewhere.** All non-stranger rows byte-identical on numeric counters to the locked baseline; full suite `npx vitest run --reporter=dot` green.

- [ ] **Step 3: Re-snapshot + guard:**

```bash
npx tsx scripts/audit-corpus.mjs --write-baseline
npx tsx scripts/audit-corpus.mjs --check-baseline   # "✓ No regressions vs baseline."
npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts --reporter=dot
```

- [ ] **Step 4: Append results to the findings doc** — a "Repeat-chorus matching (follow-up)" section with before/after needs_review per song, remaining flagged lines + their carve-out evidence, and the success-bar verdict (met / met-with-carve-outs / gap remains with analysis).

- [ ] **Step 5: Commit**

```bash
git add tests/ai-pipeline/fixtures/corpus-baseline.json docs/superpowers/2026-07-line-boundary-findings.md
git commit -m "test(audit): lock repeat-chorus matching improvements into baseline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** fuzzy keys (Task 1), evidence-gated 2-occurrence re-anchor incl. Veil non-regression (Task 2), interjection carve-out incl. EN predicate branch discovered during planning (Task 3), unscoreable scorecard treatment (Task 4), success bar + baseline lock + documented carve-outs (Task 5). ✓
- **Known judgment points, made explicit:** the bridge test's `flaggedInRepeat ≤ 1` may need evidence-based relaxation (Task 2 Step 1); the strictly-better gate (`afterScore <= beforeScore` → revert) is deliberately conservative; Task 5 forbids snapshotting unexplained numbers.
- **Type consistency:** `blockQualityScore(out, blockStart, blockLen, clean, sourceLanguage)` matches its single call pattern; `strippedForRepeat`/`linesSimilar`/`charLcsLen` used only within repeatedStanzaAlignment.ts; `isInterjectionLyricLine` signature unchanged (pure extension).
