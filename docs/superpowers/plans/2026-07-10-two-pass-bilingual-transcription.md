# Two-Pass Bilingual Transcription Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For mixed JA/EN songs, transcribe twice (forced Japanese + forced English) and merge the two alignments per lyric line by language, recovering English sections that forced-Japanese decoding garbles.

**Architecture:** Approach A — align twice, select per line. Run the existing `refineAlignmentWithPhrases` on each transcript independently (both share a common audio clock), then a pure `mergeBilingualAlignments` picks each line's timing from the pass matching its script (quality tie-break), runs the exported `enforceLineMonotonicity` + `redistributeDegenerateRuns` to smooth pass-boundary seams, and rebuilds phrases. A mixed-sheet detector gates a default-on UI toggle. The core aligner is reused as a black box.

**Tech Stack:** TypeScript, vitest, tsx, existing corpus harness (`scripts/audit-corpus.mjs`), React (AutoAlignFlow toggle).

**Spec:** docs/superpowers/specs/2026-07-10-two-pass-bilingual-transcription-design.md

## Key existing signatures (verified)
- `refineAlignmentWithPhrases(sheetRows: TimedLine[], words: TranscriptWord[], sourceLanguage: Language, lyricsBase?): RefinedAlignment`
- `RefinedAlignment { lines: TimedLine[]; phrases: SungPhrase[]; report; mode: 'content'|'proportional'; confidence: number; anchorSources?: LineAnchorSource[]; lineAlignmentQuality?: LineAlignmentQuality[]; phraseLayout; sheetLinesSnapshot? }`
- `enforceLineMonotonicity(out: TimedLine[]): void` — mutates in place; currently PRIVATE in phraseAlignment.ts (~line 288), export it.
- `redistributeDegenerateRuns(lines: TimedLine[], words: TranscriptWord[], sourceLanguage: Language, anchoredMask?: boolean[]): { lines: TimedLine[]; redistributed: boolean[]; onActivity: boolean[] }` — exported from src/lyrics/redistributeDegenerateRuns.ts.
- `LineAlignmentQuality = 'good' | 'approximate' | 'needs_review'`; `qualityRank(q)` exported from contentAligner.ts (good=highest).
- `SungPhrase` has `sourceLineIndices: number[]`, `startTime`, `endTime`.
- `TranscriptWord = { word: string; startTime: number; endTime: number }` (aligner.ts).

## File map
- `src/ai-pipeline/whisperLanguage.ts` — add `isMixedLanguageSheet`.
- `src/lyrics/phraseAlignment.ts` — export `enforceLineMonotonicity`.
- `src/lyrics/bilingualMerge.ts` (new) — `mergeBilingualAlignments`.
- `src/ai-pipeline/AutoAlignFlow.tsx` — toggle + two-transcription flow.
- `scripts/audit-corpus.mjs` + `tests/ai-pipeline/fixtures/` — two-pass corpus variant.
- Tests under `tests/`.

---

### Task 1: Mixed-language sheet detection

**Files:**
- Modify: `src/ai-pipeline/whisperLanguage.ts`
- Test: `tests/ai-pipeline/whisperLanguage.test.ts` (extend if exists, else create)

- [ ] **Step 1: Write the failing test**

Read `tests/ai-pipeline/whisperLanguage.test.ts` first (it may exist for `whisperLanguageFor`). Add:

```ts
import { isMixedLanguageSheet } from '../../src/ai-pipeline/whisperLanguage'

describe('isMixedLanguageSheet', () => {
  it('true when the sheet has >=3 substantial lines of each script', () => {
    expect(isMixedLanguageSheet([
      'ただただ荒れていく時代に', '過去の輝きに価値はない', '心の形を作る',
      'I found a place where I am not alone', 'Stranger than heaven', 'Back streets walking on the edge',
    ])).toBe(true)
  })
  it('false for a JA sheet with an occasional English hook', () => {
    expect(isMixedLanguageSheet([
      'ただただ荒れていく時代に', '過去の輝きに価値はない', 'oh yeah', '心の形を作る', '手はいつも汚れだらけ',
    ])).toBe(false)
  })
  it('false for a pure EN sheet', () => {
    expect(isMixedLanguageSheet(['hello world today', 'another line of text', 'and one more here'])).toBe(false)
  })
  it('false for a pure JA sheet', () => {
    expect(isMixedLanguageSheet(['ただただ荒れていく', '過去の輝きに', '心の形を作る', '手はいつも'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/whisperLanguage.test.ts`
Expected: FAIL — `isMixedLanguageSheet` not exported.

- [ ] **Step 3: Implement** — add to `src/ai-pipeline/whisperLanguage.ts`:

```ts
const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** A sheet is mixed-language when it has at least 3 substantial lines in each of
 * JA script and Latin (>=3 Latin words) — one-off English hooks ("oh yeah") don't
 * count. Forcing a single Whisper language on such songs garbles the other
 * language's sections, which the two-pass merge exists to fix. */
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

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/whisperLanguage.test.ts` → PASS. `npx tsc -b --noEmit` → clean. (Plain `tsc --noEmit` checks nothing in this repo — always use `tsc -b`.)

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/whisperLanguage.ts tests/ai-pipeline/whisperLanguage.test.ts
git commit --no-gpg-sign -m "feat(transcription): isMixedLanguageSheet detector for two-pass gating"
```

---

### Task 2: Export enforceLineMonotonicity

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts`

- [ ] **Step 1: Export the helper**

Find `function enforceLineMonotonicity(out: TimedLine[]): void {` (~line 288) and prepend `export `. No body change. (Mirrors how `transcriptWindowForLine` was exported for the redistribution work.)

- [ ] **Step 2: Verify nothing broke**

Run: `npx tsc -b --noEmit` → clean. `npx vitest run tests/lyrics/ tests/ai-pipeline/` → green (a `user-downloads-audit.test.ts`/`interjectionLines.test.ts` timeout under parallel load is known-flaky; re-run standalone).

- [ ] **Step 3: Commit**

```bash
git add src/lyrics/phraseAlignment.ts
git commit --no-gpg-sign -m "refactor(alignment): export enforceLineMonotonicity for the bilingual merge"
```

---

### Task 3: mergeBilingualAlignments core (synthetic tests)

**Files:**
- Create: `src/lyrics/bilingualMerge.ts`
- Test: `tests/lyrics/bilingualMerge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lyrics/bilingualMerge.test.ts
import { describe, it, expect } from 'vitest'
import { mergeBilingualAlignments } from '../../src/lyrics/bilingualMerge'
import type { TimedLine } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

// Minimal RefinedAlignment stub (only the fields the merge reads).
function align(
  lines: TimedLine[],
  quality: Array<'good' | 'approximate' | 'needs_review'>,
): RefinedAlignment {
  return {
    lines, phrases: [], report: {} as never, mode: 'content', confidence: 1,
    anchorSources: lines.map(() => 'lcs' as never),
    lineAlignmentQuality: quality,
    phraseLayout: 'sheet',
  }
}

const sheet = [
  line('ただただ荒れていく時代に', 0, 0),
  line('I found a place where I am not alone', 0, 0),
  line('過去の輝きに価値はない', 0, 0),
  line('Tore down the gates took all my pain', 0, 0),
]

describe('mergeBilingualAlignments', () => {
  it('takes JA-script lines from the JA pass and Latin lines from the EN pass', () => {
    // JA pass: JA lines placed well, EN lines garbled (needs_review, wrong times)
    const alignJ = align([
      line('ただただ荒れていく時代に', 10, 12),
      line('I found a place where I am not alone', 12, 12.3), // garbled
      line('過去の輝きに価値はない', 20, 22),
      line('Tore down the gates took all my pain', 22, 22.3), // garbled
    ], ['good', 'needs_review', 'good', 'needs_review'])
    // EN pass: EN lines placed well, JA lines garbled
    const alignE = align([
      line('ただただ荒れていく時代に', 5, 5.3), // garbled
      line('I found a place where I am not alone', 13, 16),
      line('過去の輝きに価値はない', 17, 17.3), // garbled
      line('Tore down the gates took all my pain', 24, 28),
    ], ['needs_review', 'good', 'needs_review', 'good'])
    const merged = mergeBilingualAlignments(sheet, alignJ, alignE)
    // JA lines from J, EN lines from E:
    expect(merged.lines[0]).toMatchObject({ startTime: 10, endTime: 12 })
    expect(merged.lines[1]).toMatchObject({ startTime: 13, endTime: 16 })
    expect(merged.lines[2]).toMatchObject({ startTime: 20, endTime: 22 })
    expect(merged.lines[3]).toMatchObject({ startTime: 24, endTime: 28 })
    // Monotonic:
    for (let i = 1; i < merged.lines.length; i++) {
      expect(merged.lines[i].startTime).toBeGreaterThanOrEqual(merged.lines[i - 1].startTime)
    }
    // Quality carried from the chosen pass:
    expect(merged.lineAlignmentQuality).toEqual(['good', 'good', 'good', 'good'])
  })

  it('quality tie-break: a Latin line the EN pass could not anchor falls back to a good JA-pass result', () => {
    const s = [line('過去の輝きに価値はない', 0, 0), line('Oh la la la', 0, 0)]
    const alignJ = align([line('過去の輝きに価値はない', 10, 12), line('Oh la la la', 12, 14)], ['good', 'good'])
    const alignE = align([line('過去の輝きに価値はない', 5, 5.3), line('Oh la la la', 40, 40.3)], ['needs_review', 'needs_review'])
    const merged = mergeBilingualAlignments(s, alignJ, alignE)
    // EN line: EN pass is needs_review, JA pass is good → take JA pass.
    expect(merged.lines[1]).toMatchObject({ startTime: 12, endTime: 14 })
    expect(merged.lineAlignmentQuality![1]).toBe('good')
  })

  it('blank/interjection lines default to the JA pass', () => {
    const s = [line('心の形を作る', 0, 0), line('嗚呼', 0, 0)]
    const alignJ = align([line('心の形を作る', 10, 12), line('嗚呼', 12, 13)], ['good', 'approximate'])
    const alignE = align([line('心の形を作る', 5, 5.3), line('嗚呼', 30, 30.3)], ['needs_review', 'needs_review'])
    const merged = mergeBilingualAlignments(s, alignJ, alignE)
    expect(merged.lines[1]).toMatchObject({ startTime: 12, endTime: 13 })
  })

  it('returns the JA alignment unchanged when the EN alignment is null (EN pass failed)', () => {
    const alignJ = align([line('ただ', 10, 12), line('I found a place', 12, 14)], ['good', 'needs_review'])
    const merged = mergeBilingualAlignments([line('ただ', 0, 0), line('I found a place', 0, 0)], alignJ, null)
    expect(merged.lines).toEqual(alignJ.lines)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lyrics/bilingualMerge.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/lyrics/bilingualMerge.ts`:

```ts
import type { Language, TimedLine } from '../core/types'
import type { SungPhrase } from '../core/types'
import { enforceLineMonotonicity, type RefinedAlignment } from './phraseAlignment'
import { redistributeDegenerateRuns } from './redistributeDegenerateRuns'
import { qualityRank, type LineAlignmentQuality } from '../ai-pipeline/contentAligner'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

function isLatinLine(text: string): boolean {
  return !JA_SCRIPT_RE.test(text) && (text.match(/[A-Za-z']+/g) ?? []).length >= 1
}

/**
 * Merge a forced-Japanese and a forced-English alignment of the same sheet.
 * Both passes transcribe the same audio, so their times share a clock. For each
 * line, pick the pass matching its script (Latin → EN pass, else JA pass), then
 * take the OTHER pass if the script-selected pass rates the line needs_review but
 * the other rates it better. Smooth pass-boundary seams with the existing
 * monotonicity + redistribution passes.
 *
 * `wordsForActivity` (optional) is the union of both passes' transcript words,
 * used only to give the redistribution pass activity regions to place onto; when
 * omitted, redistribution is skipped (monotonicity-only reconcile).
 * `alignE === null` means the English pass failed — return the JA alignment as-is.
 */
export function mergeBilingualAlignments(
  sheetRows: TimedLine[],
  alignJ: RefinedAlignment,
  alignE: RefinedAlignment | null,
  sourceLanguage: Language = 'ja',
  wordsForActivity?: TranscriptWord[],
): RefinedAlignment {
  if (!alignE) return alignJ

  const qJ = alignJ.lineAlignmentQuality ?? alignJ.lines.map(() => 'needs_review' as LineAlignmentQuality)
  const qE = alignE.lineAlignmentQuality ?? alignE.lines.map(() => 'needs_review' as LineAlignmentQuality)

  const chosen: Array<'J' | 'E'> = sheetRows.map((row, i) => {
    const text = row.original || row.translation
    const primary: 'J' | 'E' = isLatinLine(text) ? 'E' : 'J'
    const other: 'J' | 'E' = primary === 'J' ? 'E' : 'J'
    const primQ = primary === 'J' ? qJ[i] : qE[i]
    const otherQ = other === 'J' ? qJ[i] : qE[i]
    // Take the other pass only when primary is needs_review and other is strictly better.
    if (primQ === 'needs_review' && qualityRank(otherQ) > qualityRank(primQ)) return other
    return primary
  })

  const lines: TimedLine[] = sheetRows.map((_, i) =>
    ({ ...(chosen[i] === 'J' ? alignJ.lines[i] : alignE.lines[i]) }))
  const lineAlignmentQuality = sheetRows.map((_, i) => (chosen[i] === 'J' ? qJ[i] : qE[i]))
  const anchorSources = sheetRows.map((_, i) => {
    const src = chosen[i] === 'J' ? alignJ.anchorSources?.[i] : alignE.anchorSources?.[i]
    return src ?? 'interpolated'
  })

  enforceLineMonotonicity(lines)
  let finalLines = lines
  if (wordsForActivity && wordsForActivity.length) {
    finalLines = redistributeDegenerateRuns(lines, sanitizeTranscript(wordsForActivity), sourceLanguage).lines
  }

  // Phrases: keep each phrase from the pass its source lines were selected from;
  // re-sync its span to the merged line times. A phrase spanning both passes takes
  // the merged min/max of its lines.
  const phrases = mergePhrases(alignJ.phrases, alignE.phrases, chosen, finalLines)

  return {
    ...alignJ,
    lines: finalLines,
    phrases,
    anchorSources: anchorSources as RefinedAlignment['anchorSources'],
    lineAlignmentQuality: lineAlignmentQuality as RefinedAlignment['lineAlignmentQuality'],
  }
}

function mergePhrases(
  phrasesJ: SungPhrase[],
  phrasesE: SungPhrase[],
  chosen: Array<'J' | 'E'>,
  mergedLines: TimedLine[],
): SungPhrase[] {
  // Take phrases from whichever pass owns the majority of each phrase's source
  // lines, then re-sync span to merged line times so display matches the lines.
  const pick = (p: SungPhrase): boolean => {
    const votes = p.sourceLineIndices.reduce((n, li) => n + (chosen[li] === 'E' ? 1 : -1), 0)
    return votes > 0 // true → from E
  }
  const out: SungPhrase[] = []
  for (const p of phrasesJ) if (!pick(p)) out.push(resync(p, mergedLines))
  for (const p of phrasesE) if (pick(p)) out.push(resync(p, mergedLines))
  out.sort((a, b) => a.startTime - b.startTime)
  return out
}

function resync(p: SungPhrase, mergedLines: TimedLine[]): SungPhrase {
  const starts = p.sourceLineIndices.map((i) => mergedLines[i]?.startTime).filter((t): t is number => Number.isFinite(t))
  const ends = p.sourceLineIndices.map((i) => mergedLines[i]?.endTime).filter((t): t is number => Number.isFinite(t))
  if (!starts.length) return p
  return { ...p, startTime: Math.min(...starts), endTime: Math.max(...ends) }
}
```

Note: import `SungPhrase`/`LineAlignmentQuality`/`RefinedAlignment` from wherever they're actually exported (grep — `SungPhrase` and `LineAlignmentQuality` may live in `core/types` or be re-exported from phraseAlignment/contentAligner; adjust the import lines to the real source). `qualityRank` is exported from contentAligner.ts.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lyrics/bilingualMerge.test.ts` → PASS (4). The synthetic tests don't pass `wordsForActivity`, so redistribution is skipped and only selection + monotonicity run — that's why the expected times are the raw selected ones. `npx tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/bilingualMerge.ts tests/lyrics/bilingualMerge.test.ts
git commit --no-gpg-sign -m "feat(alignment): mergeBilingualAlignments — per-line JA/EN pass selection"
```

---

### Task 4: Prove the win on a corpus fixture

**Files:**
- Create: `tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.forced-en.json`
- Modify: `scripts/audit-corpus.mjs` (add an optional two-pass merge path + row)
- Modify: `tests/ai-pipeline/fixtures/corpus.json`, `tests/ai-pipeline/fixtures/corpus-baseline.json`
- Test: `tests/ai-pipeline/bilingualMerge.corpus.test.ts` (new)

- [ ] **Step 1: Generate + commit the forced-English transcript fixture**

The forced-JA transcript already exists (`transcript.word.json`). Generate the forced-EN one (~minutes, small model in Node):
```bash
npx tsx scripts/transcribe-file.mjs ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 \
  --language english --mode word \
  --out tests/ai-pipeline/fixtures/stranger-than-heaven/transcript.word.forced-en.json
```
Eyeball it: the EN chorus/rap regions (~25-40s, ~100-130s, ~160-198s) should read as recognizable English ("Nothing stays buried no names", "Stranger than heaven", "Paved my way…"), confirming the pass is useful.

- [ ] **Step 2: Add a merge helper invocation to the audit script**

In `scripts/audit-corpus.mjs`, read how songs are scored. Add support for an optional `transcriptEn` field on a corpus song: when present, the script runs `refineAlignmentWithPhrases` on BOTH transcripts and `mergeBilingualAlignments(sheetRows, alignJ, alignE, song.lang, unionWords)` (import it), scoring the MERGED result's metrics. `unionWords` = `sanitizeTranscript([...wordsJ, ...wordsE])`. Add the import near the other dynamic imports:
```js
const { mergeBilingualAlignments } = await import(pathToFileURL(join(root, 'src/lyrics/bilingualMerge.ts')).href)
```
Guard: only run the two-pass path when `song.transcriptEn` is set; otherwise the existing single-pass scoring is unchanged.

- [ ] **Step 3: Add the corpus variant**

In `tests/ai-pipeline/fixtures/corpus.json`, add:
```json
    {
      "name": "stranger-than-heaven-word-twopass",
      "lang": "ja",
      "lyrics": "stranger-than-heaven/lyrics.txt",
      "transcript": "stranger-than-heaven/transcript.word.json",
      "transcriptEn": "stranger-than-heaven/transcript.word.forced-en.json"
    },
```

- [ ] **Step 4: Score + assert the win**

Run: `npx tsx scripts/audit-corpus.mjs`
Compare `stranger-than-heaven-word-twopass` against `stranger-than-heaven-word`:
- `bnd_measured` must go UP (more lines anchored — the EN lines now match the EN pass).
- `align_needs_review` must go DOWN or stay equal.
- The clean songs and the single-pass stranger rows must be byte-identical (the two-pass path only runs for the new row).
Record the exact before/after numbers.

Write `tests/ai-pipeline/bilingualMerge.corpus.test.ts` asserting the twopass row beats the single-pass row on bnd_measured (load both from the scorecard the same way `corpus-scorecard.test.ts` does — read it for the pattern). If the win doesn't materialize (bnd_measured flat/down), STOP and report — the forced-EN pass may need segment mode or the merge selection needs tuning; do not fake a passing assertion.

- [ ] **Step 5: Re-snapshot baseline + commit**

```bash
npx tsx scripts/audit-corpus.mjs --write-baseline
npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/bilingualMerge.corpus.test.ts
git add scripts/audit-corpus.mjs tests/ai-pipeline/fixtures/ tests/ai-pipeline/bilingualMerge.corpus.test.ts
git commit --no-gpg-sign -m "test(corpus): two-pass bilingual merge beats single-pass on stranger EN lines"
```

---

### Task 5: Wire the two-transcription flow + toggle into AutoAlignFlow

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`
- Test: `tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` (extend)

- [ ] **Step 1: Write the failing UI test**

Read the existing test's mock setup (mocks `transcribeAudio`, `getDeviceTier`, and now needs `refineAlignmentWithPhrases`/`mergeBilingualAlignments` — check what's already mocked). Assert: for a mixed-language sheet, a control matching /mixed-language/i renders and is checked by default; when active, `transcribeAudio` is called TWICE (once with `language:'japanese'`, once with `language:'english'`); for a pure-JA sheet the control is absent and `transcribeAudio` is called once. Use the `song.lyrics.lines` in the test fixture to make it mixed (add EN lines) vs pure.

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` → FAIL.

- [ ] **Step 3: Implement the toggle + flow**

In `src/ai-pipeline/AutoAlignFlow.tsx`:
- Import `isMixedLanguageSheet` from `./whisperLanguage` and `mergeBilingualAlignments` from `../lyrics/bilingualMerge`.
- Compute `const sheetLineTexts = song.lyrics.lines.map((l) => l.original || l.translation)` and `const mixedLanguage = isMixedLanguageSheet(sheetLineTexts)`.
- State: `const [twoPass, setTwoPass] = useState(true)` — default on. Effective: `const useTwoPass = twoPass && mixedLanguage`.
- Render a "Mixed-language (JA+EN) — slower · re-transcribes in both languages" checkbox ONLY when `mixedLanguage`, checked by default. When `useTwoPass`, DISABLE the high-accuracy toggle with the note "uses small model in mixed-language mode" (per spec).
- Refactor the single transcribe call into a local `runTranscription(language)` helper (wrapping the existing `transcribeAudio(...)` options; parametrize `language`, keep `highAccuracy: false` when two-pass). Then:
```ts
if (useTwoPass) {
  const jaResult = await runTranscription('japanese')   // pass 1/2 progress copy
  if (cancelledRef.current) return
  const enResult = await runTranscription('english')    // pass 2/2 (warm worker, same small model)
  const wordsJ = toWords(jaResult), wordsE = toWords(enResult)
  const alignJ = refineAlignmentWithPhrases(sheetRows, wordsJ, song.lyrics.sourceLanguage, song.lyrics)
  let refined
  try {
    const alignE = refineAlignmentWithPhrases(sheetRows, wordsE, song.lyrics.sourceLanguage, song.lyrics)
    refined = mergeBilingualAlignments(sheetRows, alignJ, alignE, song.lyrics.sourceLanguage,
      sanitizeTranscript([...wordsJ, ...wordsE]))
  } catch { refined = alignJ }  // EN pass/align failure → JA-only
  // ...continue with the existing applyRefinedAlignment path using `refined`
} else {
  // existing single-pass path unchanged
}
```
where `toWords(result)` is the existing `(result.chunks ?? []).flatMap(...)` mapping (extract it to a local helper to reuse). Update the transcription progress copy to show "pass 1/2" / "pass 2/2" when `useTwoPass` (the existing `onTranscribeProgress` can prefix based on which pass is running). Keep the whole single-pass branch and its `refined`/`applyRefinedAlignment`/`db.songs.put` tail intact — two-pass just produces `refined` differently.

- [ ] **Step 4: Run + full checks**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` → PASS. `npx tsc -b --noEmit` → clean. `npx vitest run tests/ai-pipeline/ tests/lyrics/` → green. `npx tsx scripts/audit-corpus.mjs --check-baseline` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx
git commit --no-gpg-sign -m "feat(ui): mixed-language two-pass transcription toggle (default-on for mixed sheets)"
```

---

### Task 6: Findings + docs

**Files:**
- Modify: `docs/superpowers/2026-07-10-webgpu-migration-findings.md` (append a two-pass section) or a new findings doc.

- [ ] **Step 1: Document outcomes**

Append a `## Two-pass bilingual transcription` section: the corpus win numbers (stranger word twopass vs single-pass: bnd_measured before→after, needs_review before→after), the merge rule (script + quality tie-break), the JA-fallback on EN-pass failure, that it's small-model-only and default-on for mixed sheets, and the residual (the one audio-limited line "Tore down the gates…" that no method recovers). Update memory pointer [[transcription-stack]] with the two-pass addition.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/
git commit --no-gpg-sign -m "docs: two-pass bilingual transcription findings + corpus win"
```

---

## Self-review notes
- **Spec coverage:** detection → Task 1; export helper → Task 2; merge unit (script select + quality tie-break + monotonicity + redistribution + phrases + JA fallback) → Task 3; corpus proof → Task 4; two-transcription flow + default-on toggle + high-accuracy-disabled interaction + EN-fail fallback → Task 5; docs → Task 6. All covered.
- **Type consistency:** `mergeBilingualAlignments(sheetRows, alignJ, alignE, sourceLanguage?, wordsForActivity?) → RefinedAlignment` used identically in Tasks 3/4/5. `isMixedLanguageSheet(lineTexts)` Tasks 1/5. `enforceLineMonotonicity` exported Task 2, used Task 3.
- **Import-source caveat:** Task 3 flags that `SungPhrase`/`LineAlignmentQuality`/`RefinedAlignment`/`qualityRank` must be imported from their real modules — the implementer greps and adjusts (they exist; only the import path needs confirming).
- **Fixture determinism:** the forced-EN transcript is committed, so corpus audits stay MP3-free after Task 4.
