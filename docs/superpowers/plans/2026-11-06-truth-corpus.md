# Truth Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sync-benchmark truth corpus committable to git and able to grow past two songs, so that alignment accuracy becomes measurable before any Android work begins.

**Architecture:** The repository already has an honest scorer (`scripts/lib/syncBenchmark.mjs`) that reports raw error, never subtracts an offset, and refuses to certify accuracy from an unverified LRC. It is not the problem. The problem is that annotations carry lyric *text*, which rule 6 forbids committing, capping the corpus at the files that could stay local. This plan replaces text with a canonically normalised hash, adds a second-class `lrc-derived` reference kind that scores but can never certify, and makes a run that scored too few songs a failure rather than a pass.

**Tech Stack:** Node ESM, `node:test`, `node:crypto`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-utasync-android-design.md` (§8 in particular)

## Global Constraints

- **No copyrighted song text in the repository.** CLAUDE.md rule 6, ADR-0004. Nothing this plan commits may contain a lyric line. Audio and lyric sheets stay local and gitignored.
- **Offsets are reported, never subtracted.** Spec §8.2. No code added here may fit, normalise or median-shift away a constant error.
- **Only blind human onsets can certify accuracy.** Spec §8.4. `lrc-derived` truth is a regression signal, never an accuracy claim.
- **Silence is never success.** Spec §8.2. A scoring run that scored fewer songs than the manifest expects exits non-zero.
- **Lines match by index, never by content.** Repeated choruses make identical hashes; the scorer compares line *i* to line *i*.
- Existing commands must keep working: `npm run benchmark:sync -- inventory`, `npm run benchmark:test`.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test attached to the task that owns the code.

1. **A song with repeated identical lines** (a chorus) produces identical hashes for different lines; matching must stay index-based and must not deduplicate or reorder. — Task 2
2. **An annotation written under an older normalisation** must fail loudly with its version named, never be silently skipped or silently scored. — Task 2
3. **An LRC containing metadata or blank lines** (`[ar:…]`, `[by:…]`, empty lines) must not turn those into lyric lines with onsets. — Task 5
4. **A lyric sheet whose line count no longer matches its annotation** (the user re-edited the sheet) must be a counted, loud skip that feeds the shortfall failure — not an exception that aborts the whole report. — Task 4
5. **An LRC with duplicate or out-of-order timestamps** must be rejected rather than producing nonsense onsets. — Task 5

---

### Task 1: Canonical line normalisation and hashing

The hash is load-bearing: text comparison is forgiving, hashing is not. One canonical normalisation, versioned, applied before every hash.

**Files:**
- Create: `scripts/lib/lyricHash.mjs`
- Create: `scripts/lib/lyricHashChecks.mjs`
- Modify: `package.json` (add `lyricHashChecks.mjs` to the `benchmark:test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LYRIC_HASH_VERSION: string` — currently `'1'`
  - `normalizeLyricLine(line: string): string`
  - `hashLyricLine(line: string): string` — sha256 hex of the normalised line

Normalisation order is fixed and significant:
1. Remove bracketed spans entirely, including their contents: `（…）`, `(…)`, `［…］`, `[…]`, `〈…〉`.
2. NFKC-normalise.
3. Remove punctuation: `、。，．！？!?,.…‥「」『』〈〉《》・:;"'“”‘’-–—~〜`.
4. Collapse any run of whitespace (including ideographic space `　`) to a single space.
5. Trim.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLyricLine, hashLyricLine, LYRIC_HASH_VERSION } from './lyricHash.mjs'

test('full-width and half-width forms normalise together', () =>
  assert.equal(normalizeLyricLine('ＡＢＣ　１２３'), normalizeLyricLine('ABC 123')))

test('punctuation and bracketed annotations are removed', () =>
  assert.equal(normalizeLyricLine('ああ、（コーラス）そうか！'), normalizeLyricLine('ああそうか')))

test('whitespace runs collapse and edges trim', () =>
  assert.equal(normalizeLyricLine('  a　　 b  '), 'a b'))

test('different lines keep different hashes', () =>
  assert.notEqual(hashLyricLine('あおいそら'), hashLyricLine('とおいこえ')))

test('a line that normalises to nothing is still hashable and stable', () =>
  assert.equal(hashLyricLine('（間奏）'), hashLyricLine('')))

test('the version is declared', () => assert.equal(typeof LYRIC_HASH_VERSION, 'string'))
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/lyricHashChecks.mjs`
Expected: FAIL, cannot resolve `./lyricHash.mjs`

- [ ] **Step 3: Implement `scripts/lib/lyricHash.mjs`**

Export the three names above. Use `String.prototype.normalize('NFKC')` and `node:crypto` `createHash('sha256')`. The bracket-removal regex must be non-greedy so two bracketed spans on one line do not swallow the text between them.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/lib/lyricHashChecks.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Add to the test script and verify the suite still runs**

Run: `npm run benchmark:test`
Expected: PASS, existing checks plus the new ones

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/lyricHash.mjs scripts/lib/lyricHashChecks.mjs package.json
git commit -m "feat(benchmark): one canonical normalisation for lyric line hashes"
```

---

### Task 2: The scorer accepts hashed annotations

**Files:**
- Modify: `scripts/lib/syncBenchmark.mjs` (the annotation-matching guard, currently line 18)
- Modify: `scripts/lib/syncBenchmarkChecks.mjs` (append tests)

**Interfaces:**
- Consumes: `hashLyricLine`, `LYRIC_HASH_VERSION` from Task 1.
- Produces: `scoreRun` unchanged in signature. Annotation lines may now carry `textHash: string` in place of `text: string`. An annotation using hashes must declare `lineHashVersion: string` at the top level.

Matching rules, in order:
- If `annotation.lineHashVersion` is present and differs from `LYRIC_HASH_VERSION`, throw naming both versions.
- If every line has `textHash`, compare `hashLyricLine(texts[i])` to `annotation.lines[i].textHash`, by index.
- If every line has `text`, keep today's exact-text comparison (the two legacy annotation files rely on it).
- Mixed or missing throws.
- A length mismatch throws, as today.

- [ ] **Step 1: Write the failing tests**

```js
test('hashed annotations score exactly like text ones', () => {
  const hashed = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.equal(score(run, hashed).pass, true)
})

test('repeated identical lines stay matched by index', () => {
  const twoSong = { ...song }
  const texts = ['same', 'same']
  const twoRun = { ...run, lines: [{ original: 'same', startTime: 10 }, { original: 'same', startTime: 40 }] }
  const h = hashLyricLine('same')
  const a = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: h, onset: 10, uncertainty: .2 }, { textHash: h, onset: 40, uncertainty: .2 }] }
  const s = scoreRun(twoSong, texts, twoRun, a)
  assert.equal(s.scoredLines, 2)
  assert.equal(s.worstAbsoluteError, 0)
})

test('a stale normalisation version is a loud failure, not a skip', () => {
  const stale = { ...annotation, lineHashVersion: '0', lines: [{ textHash: 'x', onset: 10, uncertainty: .2 }] }
  assert.throws(() => score(run, stale), /lineHashVersion/)
})

test('normalisation differences do not break matching', () => {
  const a = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.equal(scoreRun(song, ['  line、 '], run, a).scoredLines, 1)
})

test('mixing text and hash lines is rejected', () => {
  const mixed = { ...annotation, lineHashVersion: LYRIC_HASH_VERSION, lines: [{ text: 'line', textHash: hashLyricLine('line'), onset: 10, uncertainty: .2 }] }
  assert.throws(() => score(run, mixed))
})
```

Note the fourth test: the run's `lines[i].original` comparison against `texts[i]` stays exact, because that is the app's own output and must match the sheet it was given.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run benchmark:test`
Expected: FAIL on the new tests; existing tests still pass

- [ ] **Step 3: Implement the matching rules in `scoreRun`**

Replace the single text-equality guard with the ordered rules above. Nothing else in `scoreRun` changes.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run benchmark:test`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/syncBenchmark.mjs scripts/lib/syncBenchmarkChecks.mjs
git commit -m "feat(benchmark): score against line hashes so truth can live in git"
```

---

### Task 3: `lrc-derived` truth scores but can never certify

The broad net. Thirty songs scored automatically against published timed lyrics give a regression signal; only blind human onsets give an accuracy claim. `scoreRun` already has `eligibleForAccuracyClaim` — this extends it rather than weakening it.

**Files:**
- Modify: `scripts/lib/syncBenchmark.mjs` (the `['human-onsets', 'coarse-captions']` kind guard)
- Modify: `scripts/lib/syncBenchmarkChecks.mjs` (append tests)

**Interfaces:**
- Produces: annotation `kind` may now be `'lrc-derived'`. Such a run returns full metrics (`medianAbsoluteError`, `p90AbsoluteError`, `worstAbsoluteError`, `withinHalfSecond`, `scoredLines`) with `eligibleForAccuracyClaim: false` and `pass: null`.

- [ ] **Step 1: Write the failing tests**

```js
test('lrc-derived truth produces metrics', () => {
  const s = score({ ...run, lines: [{ original: 'line', startTime: 10.4 }] }, { ...annotation, kind: 'lrc-derived' })
  assert.equal(s.status, 'SCORED')
  assert.equal(s.scoredLines, 1)
  assert.ok(Math.abs(s.worstAbsoluteError - 0.4) < 1e-9)
})

test('lrc-derived truth can never certify accuracy', () => {
  const s = score(run, { ...annotation, kind: 'lrc-derived' })
  assert.equal(s.eligibleForAccuracyClaim, false)
  assert.equal(s.pass, null)
})

test('an unverified reference is still refused outright', () =>
  assert.throws(() => score(run, { ...annotation, kind: 'unverified-lrc' })))
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run benchmark:test`
Expected: FAIL, "Unverified reference cannot score accuracy"

- [ ] **Step 3: Add `'lrc-derived'` to the accepted kinds**

Add it to the kind guard only. The `precise` predicate already requires `kind === 'human-onsets'`, so eligibility and `pass` need no change — confirm this rather than editing it.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run benchmark:test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/syncBenchmark.mjs scripts/lib/syncBenchmarkChecks.mjs
git commit -m "feat(benchmark): lrc-derived truth as a regression signal, never a claim"
```

---

### Task 4: A shortfall is a failure

Today a report with no audio present is green. That is the §8.1 failure wearing a different hat.

**Files:**
- Create: `scripts/lib/corpusCoverage.mjs`
- Create: `scripts/lib/corpusCoverageChecks.mjs`
- Modify: `scripts/sync-benchmark.mjs` (the `report` branch)
- Modify: `package.json` (add the new checks file to `benchmark:test`)

**Interfaces:**
- Consumes: the manifest shape in `benchmarks/sync/manifest.json`; per-song scored results from Task 2/3.
- Produces:
  - `coverageVerdict({ expected: number, scored: string[], skipped: Array<{ id: string, reason: string }> }): { expected: number, scoredCount: number, shortfall: number, ok: boolean, skipped: Array<{ id: string, reason: string }> }`

- [ ] **Step 1: Write the failing tests**

```js
test('a full corpus passes', () =>
  assert.equal(coverageVerdict({ expected: 2, scored: ['a', 'b'], skipped: [] }).ok, true))

test('a shortfall is not ok and names what was skipped', () => {
  const v = coverageVerdict({ expected: 2, scored: ['a'], skipped: [{ id: 'b', reason: 'audio absent' }] })
  assert.equal(v.ok, false)
  assert.equal(v.shortfall, 1)
  assert.deepEqual(v.skipped.map(s => s.id), ['b'])
})

test('scoring nothing at all is the loudest failure, never a pass', () =>
  assert.equal(coverageVerdict({ expected: 30, scored: [], skipped: [] }).ok, false))

test('a line-count mismatch is a counted skip, not a thrown report', () => {
  const v = coverageVerdict({ expected: 1, scored: [], skipped: [{ id: 'a', reason: 'annotation line count 18 != sheet 19' }] })
  assert.equal(v.ok, false)
  assert.match(v.skipped[0].reason, /line count/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/corpusCoverageChecks.mjs`
Expected: FAIL, cannot resolve module

- [ ] **Step 3: Implement `coverageVerdict`**

Pure function, no file access.

- [ ] **Step 4: Wire it into the `report` command**

In `scripts/sync-benchmark.mjs`, wrap the per-song scoring in a try/catch so a mismatching song becomes a `skipped` entry carrying the error message rather than aborting. `expected` is the count of manifest songs whose split is not `heldout`. Print the verdict, and `process.exitCode = 1` when `ok` is false.

- [ ] **Step 5: Verify the shortfall actually fails**

Run: `npm run benchmark:sync -- report; echo "exit=$?"`
Expected: the report prints, names the skipped songs, and `exit=1` (no audio is staged in a clean checkout)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/corpusCoverage.mjs scripts/lib/corpusCoverageChecks.mjs scripts/sync-benchmark.mjs package.json
git commit -m "feat(benchmark): a run that scored too few songs fails instead of passing"
```

---

### Task 5: Build a hashed annotation from a local LRC

How the corpus grows from two songs to thirty, without a lyric ever entering git.

**Files:**
- Create: `scripts/lrc-to-annotation.mjs`
- Create: `scripts/lib/lrcParse.mjs`
- Create: `scripts/lib/lrcParseChecks.mjs`
- Modify: `package.json` (add the new checks file to `benchmark:test`)

**Interfaces:**
- Consumes: `hashLyricLine`, `LYRIC_HASH_VERSION` (Task 1); `lyricLines`, `hash` from `scripts/lib/syncBenchmark.mjs`.
- Produces:
  - `parseLrc(text: string): Array<{ timeSeconds: number, text: string }>` — metadata and empty lines excluded, in file order.

CLI: `node scripts/lrc-to-annotation.mjs <song-id> <path-to.lrc>` reads the song's `lyrics` path and `audioSha256` from the manifest and writes the song's `reference.annotationPath` with `kind: 'lrc-derived'`, `lineHashVersion`, `audioSha256`, `lyricsSha256`, and one `{ textHash, onset, uncertainty: 0.3, excluded: false }` per line. It must never write a `text` field.

- [ ] **Step 1: Write the failing tests**

```js
test('metadata and blank lines are not lyrics', () => {
  const rows = parseLrc('[ar:Someone]\n[by:Someone]\n\n[00:10.00]a\n[00:12.50]b\n')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.timeSeconds), [10, 12.5])
})

test('timestamps parse to seconds', () =>
  assert.equal(parseLrc('[01:02.30]a\n')[0].timeSeconds, 62.3))

test('out-of-order timestamps are rejected', () =>
  assert.throws(() => parseLrc('[00:20.00]a\n[00:10.00]b\n'), /order/))

test('duplicate timestamps are rejected', () =>
  assert.throws(() => parseLrc('[00:10.00]a\n[00:10.00]b\n'), /duplicate/i))

test('a timestamp with no text is not a lyric line', () =>
  assert.equal(parseLrc('[00:10.00]\n[00:12.00]a\n').length, 1))
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/lrcParseChecks.mjs`
Expected: FAIL, cannot resolve module

- [ ] **Step 3: Implement `parseLrc`**

Accept `[mm:ss.xx]` and `[mm:ss.xxx]`. A line whose bracket content is not a timestamp is metadata and is dropped.

- [ ] **Step 4: Implement the CLI**

Exit non-zero with a clear message when the LRC's lyric-line count differs from the sheet's, rather than writing a mismatched annotation.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/lib/lrcParseChecks.mjs && npm run benchmark:test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lrc-to-annotation.mjs scripts/lib/lrcParse.mjs scripts/lib/lrcParseChecks.mjs package.json
git commit -m "feat(benchmark): generate hashed lrc-derived annotations from a local LRC"
```

---

### Task 6: Guard the committed corpus in CI

CI has no audio, so it cannot score. It can prove the committed annotations are well-formed and current — which is what stops the corpus rotting silently.

**Files:**
- Create: `scripts/corpus-ci.mjs`
- Modify: `benchmarks/sync/annotations/akfg-first-take.json` (text → hashes)
- Modify: `benchmarks/sync/annotations/will-death-poetry.json` (text → hashes)
- Modify: `.github/workflows/ci.yml`
- Modify: `benchmarks/sync/README.md`

**Interfaces:**
- Consumes: `LYRIC_HASH_VERSION` (Task 1), the manifest.

`scripts/corpus-ci.mjs` exits non-zero if any committed annotation: contains a `text` field on any line; declares a `lineHashVersion` other than the current one; is missing `audioSha256` / `lyricsSha256`; or is referenced by the manifest but absent.

- [ ] **Step 1: Write the failing test as the check itself**

Run: `node scripts/corpus-ci.mjs; echo "exit=$?"`
Expected: FAIL — the file does not exist yet

- [ ] **Step 2: Implement `scripts/corpus-ci.mjs`**

Report every violation found, not just the first, then exit 1.

- [ ] **Step 3: Convert the two existing annotations to hashes**

Use the local lyric sheets named in the manifest to compute each line's hash, then delete every `text` field and add `lineHashVersion`. Keep `onset`, `uncertainty`, `excluded`, `kind`, `status`, `reviewer`, `predictionsShown` and both input hashes exactly as they are.

- [ ] **Step 4: Verify the guard now passes and nothing regressed**

Run: `node scripts/corpus-ci.mjs && npm run benchmark:test && git grep -nP '[\p{Han}\p{Hiragana}\p{Katakana}]' -- benchmarks/ || echo "no song text under benchmarks/"`
Expected: the guard exits 0, the suite passes, and the grep finds no CJK under `benchmarks/`

- [ ] **Step 5: Add the guard to CI and document the workflow**

Add a step running `node scripts/corpus-ci.mjs` to `.github/workflows/ci.yml`. In `benchmarks/sync/README.md`, record: how to add a song (stage audio and sheet locally, run `lrc-to-annotation`, commit only the annotation), that hashes replace text and why, and that `report` exits non-zero on a shortfall.

- [ ] **Step 6: Commit**

```bash
git add scripts/corpus-ci.mjs benchmarks/sync .github/workflows/ci.yml
git commit -m "feat(benchmark): commit the truth corpus as hashes and guard it in CI"
```

---

## After this plan

The corpus is committable and the instrument is honest, but it still holds two songs. Growing it to roughly thirty `lrc-derived` songs plus two hand-marked ones is the owner's own work (spec §8.4), using `lrc-to-annotation.mjs` and the existing `scripts/lib/syncBenchmarkReview.html` worksheet. **Phase 0 cannot be judged until that is done**, and under spec §11a.1 the release depends on Phase 0.

**Deliberately not in this plan:** spec §7.7 requires the scorer to report flag precision and
recall, so that a "this line may be wrong" marker can itself be held to account. Nothing
produces flags yet — they are an Android-side column on a computed line — so scoring them
here would be a metric with no producer. It belongs to the plan that introduces the flag,
and is recorded here so it is not lost.

Plans two and three — the Phase 0 alignment experiment, and the Android app — are written separately.
