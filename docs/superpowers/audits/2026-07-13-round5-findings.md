# Round 5 findings — discrepancy triage (2026-07-13)

Triage of the round-5 baseline instruments into a ranked defect list. Analysis
only — no fixes in this commit. Companion to
`2026-07-13-round5-baseline.md` (verbatim baseline tables).

Instruments run (outputs identical to the Task-1 baseline — no drift):

- `npx tsx scripts/audit-vs-lrc.mjs`
- `npx tsx scripts/audit-corpus.mjs --pairing --dump-pairs` (scorecard matched
  baseline row-for-row; `--check-baseline` in Task 1 exited 0)
- A scratchpad-only detail dump that re-runs the exact same pipeline calls
  (`refineAlignmentWithPhrases` / `refineMixedLanguageAlignment` /
  `computeLineMatchedSpans` / `reconcileTokenReadings` / boundary-metric
  predicates) to print per-line and per-token detail behind each scorecard
  count. No source, fixture, or test files were touched.

Line indices below are 0-based sheet-row indices, matching `audit-vs-lrc.mjs`
output. "truth" = LRC time + the config's median version offset; "ev" = matched
transcript-span first time (Whisper's evidence); "ours" = refined line start.

---

## 1. Alignment

### 1a. Where the aligner makes Whisper's evidence WORSE (align err > transcript err)

The headline check: configs whose align p90 exceeds transcript p90.

| config | transcript p50/p90 | align p50/p90 | verdict |
|---|---|---|---|
| guitar-loneliness word | 0.29 / 1.42 | 0.45 / 1.70 | slightly worse; driven by #0 (no evidence) — see A3 |
| guitar-loneliness segment | 0.58 / 2.16 | 0.81 / 2.92 | worse; #44/#46 are aligner-caused — see A2 |
| stranger word ja-only | 0.36 / 0.71 | 0.85 / 37.74 | tail is class-A un-anchorable (known) + head #0–2 |
| stranger segment ja-only | 0.40 / 3.36 | 5.93 / 33.79 | class-A tail + verse-cascade rows 23–31 (known) + #16 (new, A2) |
| stranger word mixed 2-pass | 0.36 / 0.71 | 0.85 / 37.74 | **identical to ja-only — EN pass is a no-op, see A1** |
| stranger segment mixed 2-pass | 0.42 / 9.98 | 0.73 / 7.86 | aligner better than transcript; residual errors transcript-side |
| stranger segment medium ja-only | 0.30 / 1.45 | 0.70 / 12.92 | tail class-A + head chunk collapse #0–2 |

### 1b. Alignment findings

| id | song/config | symptom | severity | root-cause hypothesis | status |
|---|---|---|---|---|---|
| A1 | stranger-than-heaven `word mixed 2-pass` (LRC) / `stranger-than-heaven-mixed-word` (scorecard) | Mixed two-pass output is byte-identical to ja-only word (align p90 37.74s, worst #50 40.2s, #48 39.8s, #49 39.7s; every scorecard column identical to `stranger-than-heaven-word`). The forced-EN word transcript contributes nothing, while segment mode's two-pass cuts p90 33.79→7.86. Verified: `refineMixedLanguageAlignment` picks `ja` for all 59 lines; the EN word pass lands in `proportional` mode (confidence 0.318 < scoped threshold 0.443) so `lineRank` = −1 everywhere. Cause of the low confidence: 389 of 598 forced-EN word chunks have zero-duration timestamps (e.g. `" You" [49.98, 49.98]`) and `sanitizeTranscript` drops them (`if (duration <= 0) continue`, `src/ai-pipeline/aligner.ts:180`), starving the pass down to 161 words. | high | Zero-duration Whisper word timestamps discarded wholesale by `sanitizeTranscript` (`src/ai-pipeline/aligner.ts`) instead of being repaired (e.g. midpoint/epsilon expansion), so the EN pass in `src/ai-pipeline/mixedLanguageAlign.ts` can never clear its confidence gate on word-mode transcripts. | new |
| A2 | guitar-loneliness `segment` #44, #46; stranger-than-heaven `segment ja-only` + `segment mixed 2-pass` #16 | Aligner places a line seconds late despite good, near-truth span evidence: guitar #46 `ぶちまけちゃおうか 星に` ours 209.44 vs ev 204.56 / truth 204.85 (+4.6s, evidence err 0.3s); guitar #44 `なりたい 何者かでいい` ours 197.85 vs ev 195.90 / truth 194.93 (+2.9s; flagged both `lateStart` and `earlyEnd` in the boundary dump); stranger #16 `錆ひとつない…` ours 82.93 vs ev 80.90 / truth 80.90 (+2.0s, evidence err 0.0s; also +2.1s in mixed 2-pass). These are the concrete lines where align error exceeds transcript error with evidence present. | high-med | Repeat-occurrence / window redistribution in `src/lyrics/phraseAlignment.ts` overrides a good span anchor: all three lines have repeated text elsewhere in the sheet (`なりたい` at #43–44, `錆ひとつない…` recurs at rows 16/34/54), same mechanism as the class-B row-20 carve-out but at different rows. | **fixed (#46/#16) / re-triaged (#44)** — stage attribution: #46 and #16 are pass-1 late placements that `backfillLateStartsToMatchedSpan` was built to recover but gated out (coverage 6/11 = 0.545, 10/20 = 0.50 vs the old 0.55 floor); floor lowered to 0.5 (the LRC audit's own evidence floor). After: #46 err 4.6→0.29s, #16 err 2.0→0.42s (ja-only) / 2.1→0.38s (mixed). #44 is a different blocker: `projectPhraseTimingToLines` moves it 195.90→197.85, and recovery is chunk-granularity-blocked — #43/#44 share one 1.9s transcript chunk (`何回になりたいなりたい` 194.60–196.50), so any evidence-true boundary lands mid-chunk (trades a 1.95s lateStart for a bnd_midword/bnd_early flag); CLASS-T4-adjacent, left as residual. Note: correct #16 timing surfaces the documented R5 触ら false-mismatch tooltip flag in both stranger segment scorecard rows (read_mismatch 0→1, same known-noise class; read_ruby_wrong stays 0) — cleared at the Task 5 baseline ratchet. |
| A3 | guitar-loneliness `word` #0 (+3.1s) and `segment` #0 (+3.0s) | Opening line `突然降る夕立 あぁ傘もないや嫌` placed at 18.22/18.14 vs truth 15.14/15.19. No transcript evidence (ev=none, quality `approximate`) — Whisper missed the first line, and the head interpolation starts it too late. | med | Un-anchored leading-line placement: head-gap interpolation (pass-1 `alignLyrics` / `refineAlignmentWithPhrases` in `src/ai-pipeline/aligner.ts` / `src/lyrics/phraseAlignment.ts`) backs the first line off the first anchor rather than using vocal onset, landing ~3s late. | **fixed (CLASS-T3 round)** — the hypothesis "ev=none" was refined: Whisper DID hear the line, garbled (`突然古よふたちあがたさもない`, word 14.74 / segment 15.00), giving span coverage 6/14 = 0.43 — under the late-start backfill's 0.5 floor — while `backfillLineStartsToVocalOnset` found the exact silence-preceded vocal onset (14.74/15.00) and its hard 2.5s cap rejected the 3.1–3.5s pull. Fix: onset pulls beyond 2.5s (up to `LATESTART_MAX_PULL_S`) are now allowed when the line's OWN matched span starts at the onset (±0.35s, ≥3 matched chars) — the span corroboration proves the onset glyph is this line's audio, which is the exact failure mode the cap guards against. After: word #0 14.74 (err 0.40s, was 3.1s), segment #0 15.00 (err 0.19s, was 3.0s); guitar word p50/p90 0.45/1.70→0.40/1.62, segment 0.79/2.41→0.73/1.96; every stranger config byte-identical; corpus scorecard cells unchanged. Test: `tests/ai-pipeline/lineBoundary.head-onset.test.ts`. |
| A4 | my-eyes-only #37–#38 | #37 `ねえ いつも` compressed to 0.30s at 171.32 while its matched span evidence is at 157.42 (13.9s earlier); #38 `ねえ いつか` flagged `pileup` at the same start. These are the song's scorecard cells `align_pileup=1`, `align_compressed=1`. No LRC truth for this song. | med | Repeat-occurrence ambiguity on near-identical short lines (`ねえ いつも` / `ねえ いつか`): `computeLineMatchedSpans` (`src/ai-pipeline/contentAligner.ts`) anchors the earlier occurrence while redistribution pins the line into the later chorus, collapsing its duration. | **re-triaged** — stage attribution (T2 fix round): the mover is `realignRepeatedStanzaOccurrences` (`src/lyrics/repeatedStanzaAlignment.ts`), not redistribution: the third occurrence of the repeated block `ねえ いつか / ねえ いつも` (#36–37) window-realigns onto the final `ねえ いつか` audio at 171.32 (which belongs to #38), squashing #37 to 0.30s. Separate mechanism from the CLASS-T2 backfill gate — needs its own fix iteration (an occurrence-level guard against moving a line off high-coverage span evidence). **fixed (CLASS-T2b round)** — evidence guard added in `realignRepeatedStanzaOccurrences`: a re-anchored line whose own high-coverage (>=0.75, >=4 chars) matched span both agreed with its pre-realign placement and contradicts the new one (start beyond span ±2s) is reverted before the block is accepted (the 3+-occurrence path had no gate at all; the 2x quality gate still runs after). After: #37 167.00–169.00 (span-consistent; ground-truth start 167.0 per `alignment-benchmark.test.ts` truth[37]), #38 unchanged 171.32–176.24; scorecard `align_pileup` 1→0, `align_compressed` 1→0, `bnd_measured` 34→35. Bonus: #36 keeps the realign's improved 157.42 anchor (truth 157.4). Known measurement artifact: `bnd_latestart_p2` 0→1 — the now-correct #37 becomes measurable and its merged char-LCS span starts at the coincidental shared `ねえ` prefix (157.42) that truth assigns to #36 (span null), the exact same artifact the baseline already carries as `bnd_latestart_p1=1`; documented carve-out in `corpus-scorecard.test.ts` (`ALLOWED_MEASUREMENT_ARTIFACTS`), to be cleared at the Task 5 baseline ratchet. Regression test: `tests/ai-pipeline/repeatedStanzaAlignment.evidenceGuard.test.ts` (full `refineAlignmentWithPhrases` path, span-evidence anchored — no LRC truth for this song). |
| A5 | stranger `segment medium ja-only` #0–2 | Head chunk collapse: #0 at 0.00 (dur 0.38s), #1 at 0.38 (pileup), #2 spanning 0.89–14.23 (13.3s, `earlyEnd` + `lateStart`, ev 0.00→25.80); LRC errs 7.7s/12.6s/19.8s. The medium transcript's first segment covers 0–26s and the splitter distributes three sheet lines degenerately across it. Word-medium shows the mirror image (#0 dur 8.57s, #1 dur 11.43s, both needs_review; #58 zero_dur — the scorecard's `align_zero_dur=1`). | med | Oversized leading segment chunk (0–26s Whisper segment) interacts badly with collapsed-chunk expansion in `sanitizeTranscript`/`alignLyrics` (`src/ai-pipeline/aligner.ts`); intro lines are also partially class-A (alternate-take opening chorus), so some error is un-fixable at source. | **re-triaged (CLASS-T3 round)** — decomposed with per-transcript proof: (a) #0 `I found a place…` and #1 `Tore down the gates…` are **class-A un-anchorable** — they have no head evidence in any of the five stranger transcript fixtures (word/segment small, word/segment medium, segment forced-en; their words only surface at 68s+ as mid-song chorus repeats); the first head vocal evidence in every transcript is line #2's words at ~20s (word-medium stamps `You` at 20.0, LRC truth 20.7 — Whisper never heard #0/#1 at the song head in the alternate-take audio), so their 7.7s/12.6s errors are pure interpolation with zero available signal. (b) #2's 19.8s error IS our defect: the 0–25.8s `♪~You know I could take you somewhere` mega-segment is linearly subdivided from t=0, fabricating #2's anchor at 0.89 when the phrase is sung at the segment's tail. Fix attempted and reverted with measurements: extending the `[Music]` lead-in clip (`clipMarkerLeadIn`) to song-head `♪~`-prefixed chunks removes #2 from the medium worst list (19.8s→ off-list) but the identical rule fires on the small transcript's `(♪~)夜はく take yourself away` 0–26s chunk and cascades into the verse rows — stranger segment ja-only regresses p50 5.93→6.26, >1s 39→44, mixed-segment >1s 22→23, and baseline-guarded scorecard cells shift. No pace/position gate separates the two chunks (small is MORE implausibly paced, 1.37 vs 0.89 s/glyph). Deferred to a round where the verse-cascade recovery (A7) is addressed first, so a head clip can't dump error downstream. |
| A6 | stranger word/segment ja-only, tail rows #32–#51 | Contiguous drift block: 20 lines with ev=none, quality `approximate`, errors growing 4→40.2s (word) / 3.5→38.3s (segment); worst LRC outliers #48–52 are the end of this block. Exactly the documented ~20 un-anchorable EN chorus lines of the alternate/live-take fixture, plus head rows #0–2 (same cause). Count unchanged vs documentation — not grown. | high (but un-actionable at source) | Class-A carve-out: fixture MP3 is an alternate take; sheet EN chorus lines are sung with different words, so no transcript evidence exists. | known-residual |
| A7 | stranger `segment ja-only` #23–#30 | Late-anchored cascade: rows placed 117.00–128.16 vs evidence 106.45–122.00 (5–10s late each, LRC errs 4.9–12.1s), all `lateStart` + `compressed` in the boundary dump. Matches the documented "verse-cascade window recovery (segment rows ~20–30, 5–10s late)" deferred item; the mixed 2-pass config recovers these same rows (#23 err 1.5s). | med | Known open verse-cascade window recovery, deliberately deferred as high-risk. | known-residual |
| A8 | stranger `*-autolang` (both) | All 59 lines `compressed`, mode `proportional`, `bnd_measured` ≈0. This fixture intentionally replays Whisper per-chunk language-flapping on a nominally single-language song; proportional fallback is the expected degraded behavior it regression-tests (see baseline §5 note). Not a defect list entry. | low | By-design robustness fixture; guarded by `corpus-baseline.json`. | known-residual (by design) |
| A9 | akfg-firsttake-segment #7/#8 + #24 | One transcript chunk `わからないんだロリーロリー` (144.96–147.00) spans two sheet lines, putting the #7/#8 boundary mid-chunk (`bnd_midword_p2=2`); #24 ends 2.3s before its evidence end (`bnd_early_p2=1`, ev_end 299.24 vs line end 296.94). Baseline-stable. | low | Segment-chunk granularity: a boundary inside a multi-line chunk is unavoidable without sub-chunk timing; earlyEnd at #24 is trailing-chunk clipping in `sanitizeTranscript`/stitching. | new (low) |
| A10 | midword boundaries across configs | 17 pass-2 midword flags enumerated (e.g. guitar-word #5 end 39.04 inside `力` [38.64–39.22]; stranger-word #4/#5 boundary 33.93 inside `ances,`; stranger-segment-medium #12/#13 inside a 1.4s multi-line chunk). All boundaries land inside sub-word Whisper tokens or multi-line chunks; audible impact is a <0.5s highlight nudge. Counts match baseline exactly. | low | Chunk/token granularity artifact measured by `scripts/lib/boundaryMetrics.mjs`; boundary snapping does not consult token interiors. | new (low) |
| A12 | stranger `mixed-segment` #2, #44–#47 | The scorecard's `align_long_dur=1` and `align_zero_dur=1` cells: #2 spans 7.15–26.00 (18.9s — merged from the EN pass whose first chunk covers 0–26s); bridge cluster #44–#47 all `earlyEnd` with evidence 8–10s later (e.g. #45 zero-duration at 183.50 with ev_end 193.84; #46 pileup). LRC errs here are moderate (#43–#45: 3.6/2.3/2.1s) because the EN evidence itself sits in the alternate-take bridge. | med-low | EN-pass segment chunks in the bridge are late/oversized (partially class-A audio); merge in `src/ai-pipeline/mixedLanguageAlign.ts` keeps monotonicity by clamping, which squeezes #45 to zero duration. | new (low) / partially class-A |
| A11 | veil needs_review ×7 (#13, #28, #29, #32, #37, #40, #46), stranger/my-eyes-only/guitar needs_review cells | Low-confidence quality labels on lines without strong span evidence (no LRC truth for veil/my-eyes-only to score them). Counts identical to baseline. The old carve-out "veil L35 late-start (+3.16s)" is no longer measurable: veil `bnd_latestart_p2=0` (pass-1 had 3, refinement cleared them); it may persist only on lines below the 0.55 span-coverage measurement floor. | low | Informational uncertainty flags, not confirmed timing errors; the pipeline is correctly signaling weak evidence. | known state (baseline-stable) |

Guitar `segment` also shows a broad 1–2s error floor (>1s on 16/36 lines vs
6/36 for word mode; e.g. #20 err 5.5s where ours == ev == 105.20 but truth
99.73). Those lines track their transcript evidence (transcript p90 2.16s), so
they are Whisper-segment-granularity error, not aligner error — recorded here
so the outlier list is complete, not classed as an aligner defect.

Remaining nonzero scorecard cells not tabled above: `bnd_late_p2` (akfg-word 1,
guitar-segment 2, stranger-segment-medium 1, mixed-segment 1) counts line ends
that cross the next line's evidence start by >0.05s — the flip side of the same
chunk-granularity boundaries as A9/A10 (CLASS-T4); `unscoreable` is the
by-design interjection-line count (informational string, exempt from the
guard); `bnd_beyond_audio` appears only on the by-design autolang rows (A8).
All are baseline-identical.

### 1c. New alignment defect classes (ranked by listener impact)

1. **CLASS-T1 "EN word pass starved by zero-duration timestamps"** — members:
   A1 (1 finding, 2 config rows). One mechanism, biggest possible win: word-mode
   mixed songs currently get p90 37.74s where segment-mode two-pass proves
   ~7.86s is reachable.
2. **CLASS-T2 "good evidence overridden — repeat-occurrence late placement"** —
   members: A2 (3 lines across 3 config rows), A4 (2 lines). Generalization of
   the class-B carve-out mechanism to new rows; these are the lines where the
   aligner is demonstrably worse than Whisper.
   **Fix-round result:** members split across three mechanisms once
   stage-attributed. Fixed the largest (backfill coverage gate: A2 #46/#16, 3
   config rows). A2 #44 re-triaged as chunk-granularity-blocked; A4 re-triaged
   to `realignRepeatedStanzaOccurrences` and fixed in the CLASS-T2b iteration
   (occurrence-level span-evidence guard). See the A2/A4 status cells.
3. **CLASS-T3 "degenerate head placement"** — members: A3 (2 configs), A5
   (2 configs). Un-anchored or chunk-collapsed opening lines start 3–20s off;
   first impressions of a song, always heard.
   **Fix-round result:** A3 fixed (span-corroborated vocal-onset pull in
   `backfillLineStartsToVocalOnset`; guitar #0 err 3.1/3.0s → 0.40/0.19s). A5
   re-triaged: #0/#1 proven class-A (words absent from every transcript
   fixture); #2's mega-chunk fix attempted, measured, and reverted (regresses
   stranger segment ja-only via the A7 cascade) — deferred behind A7. See the
   A3/A5 status cells.
4. **CLASS-T4 "chunk-granularity boundary cosmetics"** — members: A9, A10.
   Sub-second highlight nudges; fix only if cheap.

---

## 2. Readings

`read_ruby_wrong = 0` on every row: for all 15 reading-truth entries the
displayed ruby (sung mode AND dictionary mode) resolves correctly. The nonzero
`read_mismatch` cells are the internal `readingMismatch` tooltip flag, not
display errors. All 7 flagged tokens, from the detail dump:

| id | song | line | surface | dict reading | got (displayed ruby) | flag conf | severity | root-cause hypothesis | status |
|---|---|---|---|---|---|---|---|---|---|
| R1 | veil | この手が離れても | 離れ | ハナレ | はなれ (correct) | 0.92 | low | Transcript evidence differs from dict reading by >1 edit → mismatch flag without adoption; tooltip-only noise (`src/ai-pipeline/readingReconciler.ts`). | known-residual |
| R2 | veil | 今と向き合って変わっていく | 向き合っ | ムキアッ | むきあっ (correct) | 0.85 | low | Same as R1. | known-residual |
| R3 | veil | 象ったような不幸があなたを襲うなら | 象っ | カタドッ | かたどっ (correct) | 0.85 | low | Same as R1. | known-residual |
| R4 | my-eyes-only | 迷い子の粉雪が | 粉雪 | コナユキ | こなゆき (correct) | 0.75 | low | Same as R1. | known-residual |
| R5 | stranger-than-heaven-word | 錆ひとつない 触らせやしない 媚びる気はない | 触ら | サワラ | さわら (correct) | 0.82 | low | Same as R1 (JA transcript over the mixed sheet is noisy here). | known-residual |
| R6 | guitar-loneliness-word | 息の音がするのに | 息 | イキ | いき (correct) | 0.88 | low | Same as R1; 息/いき is a reading-truth entry and displays correctly. | known-residual |
| R7 | guitar-loneliness-segment | めまいの螺旋だ | 螺旋 | ラセン | らせん (correct) | 0.80 | low | Same as R1. | known-residual |

Carve-out confirmations: veil 憂 (dict う) produced no flag and no adoption —
left alone as documented. 彷徨う resolves さまよ per reading-truth in both
stranger rows (no `read_ruby_wrong`). `read_adopt=1` on both akfg rows is the
known-good 理由→わけ adoption. **No new reading defect classes.** Counts per
song (veil 3, my-eyes-only 1, stranger-word 1, guitar-word 1, guitar-segment 1)
match baseline exactly — carve-out unchanged, not grown.

---

## 3. Pairings

From `npx tsx scripts/audit-corpus.mjs --pairing --dump-pairs` (436 pairs
dumped across veil / akfg-firsttake-word / guitar-loneliness-word — the three
songs with pairing truth). No empty glosses and no `?N?` (out-of-range) targets
anywhere in the dump. All 9 veil truth pairs are successfully blocked
(veil `pair_wrong=0`).

### 3a. Produced known-bad pairs (the scorecard's `pair_wrong` cells, decoded)

akfg `pair_wrong=6` and guitar `pair_wrong=7` are exactly the documented noise
floor — repeated lines count once per occurrence:

| id | song | pair (line) | count | status |
|---|---|---|---|---|
| P1 | akfg-firsttake-word | 前→Far (それどころか 君の前でさえも…) | 1 | known-residual |
| P2 | akfg-firsttake-word | 僕→There (そんな僕に術はないよな) | 1 | known-residual |
| P3 | akfg-firsttake-word | 持っ→my (初めから持ってないのに…) | 2 (line sung twice) | known-residual |
| P4 | akfg-firsttake-word | 何→Ah (何を間違った…) | 1 | known-residual |
| P5 | akfg-firsttake-word | だけど→know (だけどちょっと…) | 1 | known-residual |
| P6 | guitar-loneliness-word | 殴り→like (殴り書きみたいな音) | 2 | known-residual |
| P7 | guitar-loneliness-word | 状態→without (出せない状態で叫んだよ, 1st occurrence) | 1 | known-residual |
| P8 | guitar-loneliness-word | わたし→sing (馬鹿なわたしは歌うだけ) | 3 | known-residual |
| P9 | guitar-loneliness-word | 作業→somehow (エリクサーに張り替える…) | 1 | known-residual |

6 + 7 = 13 produced instances of 9 truth entries — matches the carve-out counts
exactly; not grown.

### 3b. New pairing/translation findings

| id | song/config | symptom | severity | root-cause hypothesis | status |
|---|---|---|---|---|---|
| P10 | guitar-loneliness-word (production path: any song using translation attach) | **Adjacent translations swapped on a correctly-ordered pair.** Sheet rows 42/43 (`出せない状態で叫んだよ` / `なんかになりたい`, 2nd chorus) display each other's EN: "I want to become something" / "I screamed without being able to let it out". Verified stage-by-stage: after `smartAttachSecondLanguage` the translations are correct (fixture files are line-aligned, `lyrics.ja.txt`/`lyrics.en.txt` rows 43–44); `fixAdjacentTranslationOrder` then swaps them. Induces 4 wrong pairs not in pairing-truth: 出せ→something, 状態→want, なんか→without, なり→let. First-occurrence rows 14/15 (different neighbors) are unaffected. | med (wrong translation text shown for 2 lines + wrong word colors) | `adjacentTranslationsSwapped` (`src/ai-pipeline/translationOrder.ts:46-58`): `lineGlossAffinity` is normalized by EN word count, so the very short `なんかになりたい` row (few alignable tokens, few EN words) produces unstable affinities and the swap margin (`+0.12`, `×1.2`) is cleared spuriously — 出す's broad JMdict gloss likely matches "something/become" in the other row's EN. | **new** |
| P11 | veil / akfg / guitar (word rows) | Residual embedding-noise pairs beyond the truth file, same signature as P1–P9 (function-word or re-routed content token → wrong EN word). Notable from the dump: veil 奥→smile and 繕っ→someone (re-routes after truth-blocked targets — the documented "re-route noise seen after blocking" pattern), その→want, 辿っ→Even, 向き合っ→continue; guitar うるさい→my, その→know, こんな→gotten, さ→happens, ぶちまけ→all; akfg 此処→my, 先→from, 乗せ→away. | low | Same noise-floor mechanism documented in the 2026-07 word-pairer QA (embedding sim 0.55–0.75 on tokens whose curated/JMdict gloss points elsewhere; `src/ai-pipeline/wordAligner.ts`). Candidates for pairing-truth expansion in Task 5, not a new mechanism. | known-residual |
| P12 | veil `pair_unpaired=10`, akfg-word `pair_unpaired=9`, guitar-word `pair_unpaired=19` | Unpaired-content-token counts, identical to baseline. Includes structural cases (e.g. `より色濃くなってしまうだろ` → "Will only grow darker" pairs only 色濃く; 幾億年 → only 億/年). | low | Known structural limitation of gloss/embedding coverage on compact JA lines; baseline-guarded. | known-residual |

### 3c. New pairing defect class

1. **CLASS-P1 "translation-order swap misfire on short lines"** — members: P10
   (1 finding, 2 lines + 4 induced pairs). The only new pairing mechanism this
   round; ranks below all timing classes and below furigana (which has no new
   defects) per the user-impact ordering.

---

## 4. Overall class ranking (user impact)

| rank | class | dimension | members | severity |
|---|---|---|---|---|
| 1 | CLASS-T1 zero-duration EN word timestamps starve mixed two-pass | timing | A1 | high |
| 2 | CLASS-T2 repeat-occurrence late placement overriding good evidence | timing | A2 (#46/#16 fixed; #44 residual), A4 (fixed, CLASS-T2b) | high-med |
| 3 | CLASS-T3 degenerate head placement (missing/oversized leading evidence) | timing | A3 (fixed), A5 (#0/#1 class-A; #2 deferred behind A7) | med |
| 4 | CLASS-P1 translation-order swap misfire | gloss/translation | P10 | med |
| 5 | CLASS-T4 chunk-granularity boundary cosmetics | timing (cosmetic) | A9, A10 | low |

No new furigana classes (all 7 reading flags are the documented false-mismatch
tooltip noise; displayed ruby is correct everywhere the truth file covers).

## 5. Known-residual confirmations (unchanged vs grown)

- Class-A alternate-take un-anchorable lines: 20-line contiguous tail block
  (#32–#51) + head #0–2 — **unchanged** (matches "~20 lines" documentation;
  scorecard identical to baseline).
- Class-B row-20 repeat mis-anchor: present, sub-second in LRC terms
  (word ja-only #20 err < 1s) — **unchanged**; A2 documents the same mechanism
  firing at *new* rows, tracked as new.
- Verse-cascade rows ~20–30 segment ja-only (A7) — **unchanged**, still 5–10s
  late, still recovered by the mixed two-pass config.
- veil L35 late-start — **not reproducible at pass 2** (`bnd_latestart_p2=0`
  for veil); either fixed by a prior round or now below the span-coverage
  measurement floor.
- Reading false-mismatch flags — **unchanged** (7 flags, same tokens/counts).
- Pairing noise floor — **unchanged** (13 produced instances = documented
  akfg 6 + guitar 7; veil truth pairs all blocked).
