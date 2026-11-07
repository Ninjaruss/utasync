# Make the Phase 0 Gate Evaluable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ADR-0003 alignment gate something that can actually be evaluated — one truth vocabulary shared by every tool, PJS-derived truth that can live in git, and a gate restated in terms of evidence that exists.

**Architecture:** Phase 0 is already built: arm D (`knownTextAlign.mjs`) runs, `score.mjs` reports, `runAll.sh` batches, and a PJS corpus builder exists. What is missing is not code to run the experiment but the ability to *judge* it. Three tools now disagree about what a truth kind is, PJS truth cannot be committed, and the pre-registered gate requires evidence (≥10 songs of blind human onsets) that does not exist and would take one person a week of listening. This plan fixes the first two and honestly restates the third.

**Tech Stack:** Node ESM, `node:test`, `node:crypto`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-utasync-android-design.md` (§8, §11a.1)
**Builds on:** `docs/superpowers/plans/2026-11-06-truth-corpus.md` (plan 1 of 3, PR #62)

## Global Constraints

- **No copyrighted song text in the repository.** CLAUDE.md rule 6, ADR-0004. PJS lyrics are CC BY-SA 4.0 and could in principle be committed, but they go in as hashes anyway so one rule covers every annotation.
- **Offsets are reported, never subtracted.** Both scorers currently compute raw `Math.abs` error; `score.mjs`'s "median signed shift" is a truth-free diagnostic in section 2 and must stay out of the accuracy path.
- **Only blind human onsets and corpus-derived onsets may certify accuracy.** `lrc-derived` is a regression signal. `coarse-captions` cannot certify. This distinction is the thing being unified, not relaxed.
- **A gate that cannot be evaluated must say so.** `score.mjs` already prints "**The gate cannot be evaluated from this report.**" — no change may turn that into silence.
- **No new dependency, no network at build or test time.** The PJS archive is a manual download by the user.
- `npm run benchmark:test` must keep running every checks file (currently four, 43 tests).

## Review Focus

Five conditions the spec implies that no task's happy path exercises.

1. **A `corpus-onsets` annotation reaching `scoreRun`** — today it is an unknown kind, so the song becomes a counted skip and the corpus silently shrinks rather than erroring. — Task 1
2. **Two PJS medleys containing the same sung sentence** produce identical line hashes, as do repeated lines within one medley; matching stays strictly by index and never deduplicates or cross-matches. — Task 2
3. **An annotation whose `audioSha256` no longer matches the manifest** (the medley was rebuilt) must be rejected loudly, not scored against the wrong audio. — Task 3
4. **`score.mjs` performs no lyric/order check at all** — it reads `ann.lines[i].onset` by index without confirming the annotation describes this sheet. A re-split sheet scores every line against the wrong onset, silently. — Task 2
5. **A gate evaluated on fewer songs than it requires** must report the shortfall as a failure to evaluate, never as a pass. — Task 4

---

### Task 1: One truth vocabulary, shared

Three tools disagree today. `scoreRun` accepts `human-onsets | coarse-captions | lrc-derived`. `experiments/phase0/score.mjs` accepts `human-onsets | corpus-onsets`. `corpus-ci.mjs` validates shape without opinion. So a PJS annotation is invisible to one scorer and authoritative to the other.

**Files:**
- Create: `scripts/lib/truthKinds.mjs`
- Create: `scripts/lib/truthKindsChecks.mjs`
- Modify: `scripts/lib/syncBenchmark.mjs` (the kind guard and the `precise` predicate)
- Modify: `experiments/phase0/score.mjs:60` (the kind filter)
- Modify: `scripts/corpus-ci.mjs` (reject an unknown kind)
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `TRUTH_KINDS: Record<string, { scores: boolean, certifies: boolean, note: string }>` — the single table. `human-onsets` and `corpus-onsets` certify; `lrc-derived` scores but does not certify; `coarse-captions` scores but does not certify; `unverified-lrc` neither.
  - `canScore(kind: string): boolean`
  - `canCertify(kind: string): boolean`
  - `isKnownKind(kind: string): boolean`

- [ ] **Step 1: Write the failing tests**

```js
test('every kind that certifies also scores', () => {
  for (const [k, v] of Object.entries(TRUTH_KINDS)) if (v.certifies) assert.equal(v.scores, true, k)
})
test('corpus-derived onsets certify', () => assert.equal(canCertify('corpus-onsets'), true))
test('lrc-derived scores but never certifies', () => {
  assert.equal(canScore('lrc-derived'), true); assert.equal(canCertify('lrc-derived'), false)
})
test('coarse captions score but never certify', () => {
  assert.equal(canScore('coarse-captions'), true); assert.equal(canCertify('coarse-captions'), false)
})
test('an unverified reference neither scores nor certifies', () => {
  assert.equal(canScore('unverified-lrc'), false); assert.equal(canCertify('unverified-lrc'), false)
})
test('an unknown kind is not silently tolerated', () => {
  assert.equal(isKnownKind('invented'), false); assert.equal(canScore('invented'), false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/truthKindsChecks.mjs` — FAIL, cannot resolve module

- [ ] **Step 3: Implement `scripts/lib/truthKinds.mjs`**

A frozen table plus three predicates. No I/O.

- [ ] **Step 4: Point all three tools at it**

In `syncBenchmark.mjs`, replace the literal kind array with `canScore`, and add `canCertify(annotation.kind)` as a conjunct of `precise` — it must not loosen `precise`, which still requires blind, adjudicated, reviewed marks. In `score.mjs:60`, replace its literal array with `canCertify`. In `corpus-ci.mjs`, add a violation for an annotation whose `kind` fails `isKnownKind`.

- [ ] **Step 5: Add the Review Focus test for a corpus-onsets annotation reaching `scoreRun`**

```js
test('corpus-derived onsets score and can certify in scoreRun', () => {
  const s = score(run, { ...annotation, kind: 'corpus-onsets' })
  assert.equal(s.status, 'SCORED')
  assert.equal(s.scoredLines, 1)
})
```

- [ ] **Step 6: Verify and commit**

Run: `npm run benchmark:test` (count rises from 43) and `node scripts/corpus-ci.mjs` (still exits 0)

```bash
git add scripts/lib/truthKinds.mjs scripts/lib/truthKindsChecks.mjs scripts/lib/syncBenchmark.mjs experiments/phase0/score.mjs scripts/corpus-ci.mjs package.json
git commit -m "feat(benchmark): one truth vocabulary every scorer agrees on"
```

---

### Task 2: Phase 0 checks that an annotation describes the sheet it is scoring

`score.mjs` reads `ann.lines[i].onset` by index and never confirms the annotation matches the lyric sheet. Plan 1 gave the main scorer a hash check for exactly this; the experiment that decides the Android engine has none.

**Files:**
- Modify: `experiments/phase0/score.mjs`
- Create: `experiments/phase0/scoreChecks.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `hashLyricLine`, `LYRIC_HASH_VERSION` from `scripts/lib/lyricHash.mjs`; `lyricLines` from `scripts/lib/syncBenchmark.mjs`.
- Produces: `assertAnnotationDescribesSheet(annotation, texts, songId): void` — exported from `score.mjs` for testing, throwing with the song id and the first mismatching index, never the text.

- [ ] **Step 1: Write the failing tests**

```js
test('a hashed annotation matching the sheet is accepted', () => { /* no throw */ })
test('a re-split sheet is rejected by line count, naming the song', () =>
  assert.throws(() => assertAnnotationDescribesSheet(ann2, ['a'], 'pjs-medley-01'), /pjs-medley-01/))
test('a changed line is rejected by index, and the message carries no text', () => {
  try { assertAnnotationDescribesSheet(ann, ['a', 'CHANGED'], 'song'); assert.fail('should throw') }
  catch (e) { assert.match(e.message, /line 2/); assert.ok(!e.message.includes('CHANGED')) }
})
test('repeated identical lines stay matched by index', () => { /* two identical texts, distinct onsets */ })
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test experiments/phase0/scoreChecks.mjs` — FAIL

- [ ] **Step 3: Implement and wire it in**

Call it in the accuracy loop before scoring a song. A mismatch is a **reported skip with its reason**, not an aborted report — the same shape plan 1 used.

- [ ] **Step 4: Verify and commit**

Run: `npm run benchmark:test` then `node experiments/phase0/score.mjs | head -30`

```bash
git add experiments/phase0/score.mjs experiments/phase0/scoreChecks.mjs package.json
git commit -m "feat(phase0): refuse to score an annotation that does not describe the sheet"
```

---

### Task 3: PJS truth that can be committed

Real Japanese singing with known onsets, CC BY-SA 4.0, and no listening pass. The builder exists; its output cannot currently be committed or validated.

**Files:**
- Modify: `experiments/phase0/pjs/buildCorpus.mjs`
- Modify: `scripts/corpus-ci.mjs` (cover the PJS annotation directory)
- Modify: `experiments/phase0/README.md`

**Interfaces:**
- Consumes: `hashLyricLine`, `LYRIC_HASH_VERSION`.
- Produces: per medley, an annotation of `kind: 'corpus-onsets'` carrying `lineHashVersion`, `audioSha256`, `lyricsSha256`, and one `{ textHash, onset, uncertainty, excluded: false }` per line — **no `text` field**. `uncertainty` comes from the PJS label precision; state it in the file and in the ledger, do not invent it.

The builder must refuse to overwrite an annotation that is not already `corpus-onsets`, matching the rule plan 1 applied to the LRC generator.

- [ ] **Step 1: Write the failing test**

Read `experiments/phase0/pjs/buildCorpus.mjs` first — these assert against the Interfaces shape above, and the builder's current output shape determines how you factor the annotation writer out to test it.

```js
test('a built annotation carries hashes and no text', () => {
  const a = buildAnnotation({ lines: [{ text: 'a', onset: 1 }, { text: 'b', onset: 3 }], audioSha256: 'aa', lyricsSha256: 'bb' })
  assert.equal(a.kind, 'corpus-onsets')
  assert.equal(a.lineHashVersion, LYRIC_HASH_VERSION)
  assert.deepEqual(a.lines.map(l => l.textHash), [hashLyricLine('a'), hashLyricLine('b')])
  assert.ok(a.lines.every(l => !('text' in l)))
  assert.ok(a.lines.every(l => l.excluded === false && Number.isFinite(l.uncertainty)))
})

test('it refuses to overwrite an annotation that is not corpus-onsets', () =>
  assert.throws(() => assertSafeToWrite({ kind: 'human-onsets' }), /human-onsets/))
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Emit the hashed schema**

Hash the **sheet** lines the medley writes, for the same reason plan 1 hashed the sheet and not the LRC: the scorer hashes the sheet.

- [ ] **Step 4: Bring the PJS annotations under the guard**

`corpus-ci.mjs` must scan and validate them wherever they are written, and the CJK backstop must cover them.

- [ ] **Step 5: Document the manual download**

In `experiments/phase0/README.md`: where PJS comes from, its licence, the exact build commands, and that the archive is never committed.

- [ ] **Step 6: Verify and commit**

Run: `node scripts/corpus-ci.mjs` and `npm run benchmark:test`

```bash
git add experiments/phase0/pjs/buildCorpus.mjs scripts/corpus-ci.mjs experiments/phase0/README.md
git commit -m "feat(phase0): PJS medleys produce committable hashed corpus truth"
```

---

### Task 4: Restate the gate in terms of evidence that can exist

ADR-0003's gate requires ≥10 songs of blind human onsets. Zero songs have them; `score.mjs` correctly reports the gate as unevaluable. At ~50 lines a song, two passes each, that gate is over a thousand marks from one person — which is why it has stayed at zero. Spec §8.5 says to re-derive it from the corpus rather than inherit it.

This task writes the decision, not code.

**Files:**
- Modify: `docs/adr/0003-known-text-alignment-hypothesis.md`
- Create: `docs/adr/0006-how-alignment-accuracy-is-measured.md`
- Modify: `experiments/phase0/score.mjs` (report the restated gate's terms)
- Modify: `docs/superpowers/audits/2026-09-28-measurement-ledger.md`

The restated gate must state, in numbers a reader can check against a report:
- **Which evidence certifies** — `human-onsets` and `corpus-onsets` only (Task 1's table).
- **How many songs and lines**, split by kind: PJS medleys carry the volume; real J-pop carries the realism. Spec §8.4 is explicit that LRC-covered songs flatter the aligner, because it only ever runs where no LRC exists — so a gate passed on PJS alone is not passed.
- **A stratified line sample** rather than every line of every song, with the sampling rule written down so it cannot be chosen after seeing results.
- **The threshold**, and whether 250 ms is defensible for *sung* onsets, which are genuinely soft. If it is kept, say what it rests on; if it is changed, say why. Do not invent a measurement — cite L30/L36 or state plainly that it is a judgement.
- **What "beats A and B on p90" means** when A has not run on the same songs.

ADR-0006 records the measurement regime itself: offsets reported not subtracted, truth stored as hashes, a run that scored too few songs fails. That is spec §12's "new ADR on measurement", and it is what stops the next session re-litigating plan 1.

- [ ] **Step 1: Read the current ADR-0003 and `score.mjs`'s gate section in full**

- [ ] **Step 2: Write ADR-0006**, with the condition that would reverse it.

- [ ] **Step 3: Revise ADR-0003**, keeping its hypothesis and decision rule, replacing only the gate's evidence terms. Record what changed and why, so the revision is not mistaken for the original.

- [ ] **Step 4: Make `score.mjs` report against the restated gate**, including the Review Focus case: fewer songs than required prints a failure to evaluate, never a pass.

- [ ] **Step 5: Add a ledger line** for any numeric threshold the ADR states.

- [ ] **Step 6: Verify and commit**

Run: `node experiments/phase0/score.mjs | head -40` — the gate section must state its terms and its current verdict (unevaluable today).

```bash
git add docs/adr experiments/phase0/score.mjs docs/superpowers/audits/2026-09-28-measurement-ledger.md
git commit -m "docs(adr): a gate stated in evidence that can exist, and how accuracy is measured"
```

---

## After this plan

The gate becomes evaluable as soon as evidence exists. Two things produce it, both the owner's:

1. **Download PJS ver. 1.1** (CC BY-SA 4.0, manual) and run the builder. This is the cheap volume, and needs no listening.
2. **Mark the stratified sample** on real J-pop with `npm run benchmark:sync -- review <song>`, using the worksheet plan 1 taught to emit hashes.

Then `bash experiments/phase0/runAll.sh` and `node experiments/phase0/score.mjs`.

**Deliberately not in this plan:**

- **Arm C needs a licence-clean model.** ADR-0003 names MMS, which is CC-BY-NC-4.0 and cannot ship, and the arm has never run because the model could not be fetched. A candidate exists — `nvidia/parakeet-tdt_ctc-0.6b-ja` (CC-BY-4.0), usable through Apache-2.0 sherpa-onnx, which documents no forced-alignment API, so a CTC Viterbi aligner is roughly 150 lines of our own code. That is a spike with a pass/fail gate written before the first run (CLAUDE.md rule 3), not a task here.
- **Plan 3, the Android app.** Independent of which engine wins; everything in spec §6–§7 except the aligner itself can be built in parallel.
