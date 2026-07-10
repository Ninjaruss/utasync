# Line-boundary findings across the expanded corpus

**Date:** 2026-07-07
**Commit:** `2e82e1b` (branch `line-boundary-accuracy`)
**Instrument:** `scripts/audit-corpus.mjs` + `scripts/lib/boundaryMetrics.mjs`
**Task:** 7 of 9 — measure, attribute, rank line-boundary defects to drive the fix loop (Task 8/9).

Every claim below carries a line index + timestamp, produced by a throwaway diagnostic
(`diagnose-boundaries.mjs`, not committed) that replays `alignLyrics` (pass 1) and
`refineAlignmentWithPhrases` (pass 2) over the committed fixtures and prints one row per
tripped counter. Pass-2 attribution was confirmed by bisecting the tuner chain
(`SKIP_TUNER` env gate, reverted; `git status` clean).

`p1` = `alignLyrics` standalone; `p2` = full `refineAlignmentWithPhrases`.

## 1. Scorecard snapshot

```
song                          lines  needs_rev  measured  early_p1  early_p2  latestart_p1  latestart_p2  late_p1  late_p2  midword_p2  gap_p50_p2  gap_p95_p2
veil                          48/48      7        31         0         0          3             4           1        1         0          0.32s       3.16s
akfg-firsttake-word           30/30      0        22         0         0          1             0           0        1         1          0.48s       4.36s
akfg-firsttake-segment        30/30      0        27         0         1          4             0           4        0         8          0s          6.5s
my-eyes-only                  40/40      2        34         0         2          1             0           0        0         0          0.8s        2.66s
stranger-than-heaven-word     59/59     26        20         0         1          2             3           0        0         3          0s          0.48s
stranger-than-heaven-segment  59/59     21        14         0         1          1             2           0        0         8          0s          0.5s
guitar-loneliness-word        47/47      2        37         0         0          3             1           3        1         5          0.05s       9.96s
guitar-loneliness-segment     47/47      2        33         0         2          3             4           3        1        14          0s          9.59s
```

Success bar (from the spec): zero late-ends and zero early-ends >0.35s on well-matched
lines, both passes, excluding documented Whisper carve-outs; stranger-than-heaven unmatched
rate ≤1.5× the corpus median. `lateStart` is treated as a first-class defect class.

## 2. Defect classes, ranked

Ranked by (corpus count × max delta). Deltas in seconds.

### D1 — `realignMergedLineGroups` over-shifts merged chorus lines (pass-2-introduced) — HIGH confidence

**Rank driver:** guitar-seg alone contributes 3 defects with deltas up to 2.62s.

Pass 2 introduces these on guitar-loneliness-segment; they are absent in pass 1 (p1
latestart lines were L12/L9/L27, none of L4/L7/L30):

| line | text | counter | p2 delta | span vs line |
|---|---|---|---|---|
| L4 | 春と秋 どこいっちゃったんだよ | LATE_START | +2.62s | lineStart 33.08, spanFirst 30.46 |
| L7 | わたしはどこにいる | LATE_START | +1.11s | lineStart 43.07, spanFirst 41.96 |
| L30 | なんでこんな熱くなっちゃってんだ | EARLY_END | +2.36s | lineEnd 140.43, spanLast 142.79 |

**Attribution (bisection):** disabling **`realignMergedLineGroups`** (phraseAlignment.ts:389,
invoked at :1430) — and *only* that tuner — clears all three (L4 → −0.32s, L7 → −1.11s,
L30 → −0.38s, all sub-threshold). No other single tuner moves them; the other tuners
individually leave the trip in place. This is a re-timing pass that recomputes a merged
group's start/end from a group-level LCS window and pushes individual member lines to the
group's outer bounds, overshooting the true per-line onset/offset.

**Proposed fix direction:** when `realignMergedLineGroups` redistributes a group's span
across its member lines, clamp each member's start/end to its own matched span rather than
the group envelope; only apply the group re-time when the member has no usable own-span.

### D2 — `snapBoundaryToGlyphTransition` snaps to the wrong glyph (pass-2-introduced) — HIGH confidence

**Rank driver:** 3 lines across 2 songs, deltas up to 1.06s; regresses two songs that were
clean in pass 1.

| song | line | text | counter | p2 delta |
|---|---|---|---|---|
| my-eyes-only | L2 | I promise for my eyes only | EARLY_END | +0.60s (lineEnd 9.50, spanLast 10.10) |
| my-eyes-only | L14 | I promise for my eyes only | EARLY_END | +0.44s (lineEnd 65.92, spanLast 66.36) |
| veil | L5 | 温まることない痛みと | LATE_START | +1.06s (lineStart 30.40, spanFirst 29.34) |

**Attribution (bisection):** disabling **`snapBoundaryToGlyphTransition`**
(phraseAlignment.ts:316, invoked at :1443) clears all three (my-eyes L2/L14 → −1.76s/−1.92s;
veil L5 → 0.00s). No other tuner affects them. The tuner snaps a line boundary to the
nearest glyph on/off transition, but on these lines it snaps to a transition *inside* the
line's own span (clipping the end early) or to the following line's onset (starting late).
Note the my-eyes deltas (0.44–0.60s) are only marginally over the 0.35s bar — low absolute
severity, but a clean 0→2 regression.

**Proposed fix direction:** constrain the glyph-transition snap to transitions that lie
*outside* [spanFirst, spanLastEnd] for the affected edge (never pull an end before spanLast,
never push a start past spanFirst), or require the snap target to reduce, not increase, the
distance to the matched span.

### D3 — Pre-existing pass-1 late-start / late-end on well-matched lines (not repaired by pass 2) — MEDIUM confidence

These trip in pass 1 and survive tuning (persist even with all tuners disabled → projection/
pass-1 stage, not tuner-introduced):

| song | line | text | counter | p2 delta | note |
|---|---|---|---|---|---|
| veil | L1 | 変わらない今を呪ったって | LATE_START | +0.83s | p1 & p2 identical |
| veil | L3 | あなたを救えないのだろう | LATE_START | +2.34s | p1 & p2 identical; precedes real gap (D-carveout) |
| guitar-seg | L29 | より色濃くなってしまうだろ | LATE_START | +1.95s | survives all-tuners-off (d=1.95) |
| guitar-seg | L44 | なりたい 何者かでいい | EARLY_END | +0.50s | survives all-tuners-off (d=0.50) |
| guitar-word | (various) | — | LATE_START ×1 / LATE_END ×1 | ≤0.86s | small; e.g. L13→L14 lateEnd +0.86s |
| stranger-word | L3 / L12 / L17 | Stranger than heaven / 心の形を作る / I found a place… | LATE_START | +1.56 / +0.48 / +0.88 | pass 2 *adds* L3 (see D4) |

The LCS anchor lands after the singer's true onset (the first matched glyph is not the first
sung glyph — often because the leading glyph is mis-transcribed or the line opens on a held
vowel that Whisper drops). These are genuine per-line defects but modest in magnitude;
they're the residual the fix loop should chip at after D1/D2.

**Proposed fix direction:** for lines whose `spanFirst - onset` exceeds threshold, extend the
existing `backfillLineStartsToVocalOnset` window (currently clamps corrections to 0.5–2.5s and
requires the onset glyph to be un-preceded by vocal within 1.0s) to also fire when the onset
glyph is the line's *own* first matched glyph but the anchor over-trimmed the head.

### D4 — `stranger-than-heaven-word` L3 late-start (pass-2-introduced, mixed-language chorus) — MEDIUM confidence

pass 1 measures L3 fine; pass 2 introduces LATE_START +1.56s (lineStart 27.30, spanFirst
25.74) on "Stranger than heaven". This is the same over-shift family as D1/D2 acting on a
repeated-chorus line whose span the tuners retarget. Lower confidence on the exact tuner
because stranger's heavy repeat structure makes single-tuner bisection noisy; the mechanism
is the repeat-stanza re-timing chain (`realignRepeatedStanzaOccurrences` /
`realignMergedLineGroups`). Grouped here rather than D1 because the corpus impact is a single
line.

## 3. Whisper-caused carve-outs (excluded from the fix bar)

These are **not** alignment defects — the transcript itself is missing or mis-timed. Quoted
transcript evidence below. The instrument already reports `bnd_beyond_audio` for the fully-
unsung case; the big-gap cases below are correctly-aligned lines around real instrumental
breaks and should not be counted as boundary defects.

**C1 — Real instrumental breaks flagged as large gaps (gap_p95 ≈ 10s).** These are correct
alignment, not misalignment:

- **guitar-word / guitar-seg L33 → L34** (gap 9.96s / 9.59s). Transcript around 152–162s:
  last sung glyphs `真 / っ / 当` end at **152.82s**, then silence, next vocal `青 / い`
  begins at **161.98s**. A genuine ~9s instrumental break. (guitar-seg L17→L18 gap 16.5s and
  guitar-word L17→L18 gap 11.08s are the same phenomenon.)
- **veil L3 → L4** (gap 11.36s p1 / 11.84s p2). Transcript 13–26s: last vocal `ろう` ends
  **13.34s**, then instrumental markers `♪` (20.00) and `~` (20.02–24.12), next vocal `届`
  at **25.66s**. Real break.
- **akfg-seg L20 → L21** (gap 33.22s). Segment transcript emits a single held chunk
  `明日を♪` spanning **228.00–262.52s** — a long instrumental/outro; the gap is real.

**C2 — Segment transcripts collapse whole phrases into one "word".** akfg-segment opens with
eight consecutive 2.0s chunks all literally `(音楽)` ("(music)") — Whisper's instrumental
placeholder — before any lyric. Any boundary landing in that region is a transcript artifact,
not a mis-snap.

**C3 — English + interjection lines the Whisper JP-model garbled** (feeds §5). Examples:
stranger L4/L5 both flagged mid-word inside chunk `"ances,"` [33.74–34.24] — Whisper heard a
fragment of "Chances"; L51/L20 "Stranger than heaven" flagged mid-word inside a bare `"("`
chunk spanning 160.00–168.40s (a mis-emitted long token). These are matching failures rooted
in the transcript, not boundary logic.

## 4. Metric-validity notes

**`midword_p2` in SEGMENT mode is a metric artifact — do NOT treat it as a defect count.**
Evidence: the `midWord` counter (boundaryMetrics.mjs) flags any boundary landing inside a
transcript "word" of duration ≥0.4s (with 0.15s margins). In segment mode the "words" **are
whole phrases**:

- akfg-segment: **55 of 56 chunks (98%) have duration ≥0.4s**; word mode: 188 of 387 (49%).
- The flagged chunks are entire lyric phrases, e.g. `"わからないんだロリーロリー"` [144.96–147.00],
  `"わけもないのに なんだか悲しい 泣けやしないから"` [177.00–186.58], `"心の形を作るではいつも"` [59.00–65.56].

Because a segment "word" spans one or more full lines, essentially every line boundary lands
"inside" one by construction. The elevated `midword_p2` in segment rows (akfg-seg 8,
stranger-seg 8, guitar-seg 14) is measuring transcript granularity, not boundary error.

**Recommendation for Task 8/9:** exclude `midword_p2` from the segment-mode success bar
entirely, OR redefine the mid-word test to skip chunks whose duration exceeds a per-line
plausibility bound (e.g. > ~1.2s, or longer than the median chunk duration for that
transcript). Keep `midword_p2` as a real signal in **word mode** only (there the counts —
guitar-word 5, stranger-word 3 — are meaningful and mostly reflect boundaries snapped into a
single mis-transcribed kana like `"音"` or `"んな"`, worth a look but low severity).

`gap_p95_p2` is informational (a distribution stat, already emitted as a string and
baseline-exempt); §3/C1 shows the large values are real breaks. Do not gate on it.

## 5. Mixed-language findings — stranger-than-heaven

The lyric sheet is 40 EN lines, 14 JP lines, 5 interjection lines (59 total). `bnd_beyond_audio=0`
— the audio covers the whole sheet, so every unmatched line is a **matching** failure, not a
coverage gap. Classification of matched vs unmatched (pass 2, word transcript):

| class | matched | unmatched | match rate |
|---|---|---|---|
| EN | 16 | 24 | **40%** |
| JP | 4 | 10 | 29% |
| INTERJ | 0 | 5 | 0% |

Segment transcript is worse overall (EN 9/40, JP 5/14, INTERJ 0/5 → measured 14).

**Key finding: the interjection lines fail 100%** (L39–L43: "Ahh, ooh-hmm, yeah-yeah",
"Ooh-ooh (Oh)", "Oh, yeah (Hey)", "Yeah-yeah, ayy, yeah-yeah (Hey)", "(Hey) Oh, alright") —
they have no stable phonetic content for a JP-model transcript to LCS against, and mostly
show `cov=null`. These should be treated as un-scoreable (like the Whisper carve-outs), not
counted against the alignment bar.

**EN does NOT match cleanly** — it is the largest failing bucket (24 lines). But the failures
are dominated by *repeated* choruses and transcript garble, not a systematic EN-vs-JP gap:

- The **first occurrence** of each unique EN chorus line tends to match (e.g. L20 "Stranger
  than heaven" cov=18/18; the bridge L22–L30 matches well in segment mode: L23 33/33, L24
  38/41, L27 35/37). It's the **repeats** that fail: L32/L33 (2nd "I found a place…") show
  cov=4/27 and cov=null; L44–L50 (repeated "Paved my way…" chorus) all sit at cov 2/33–12/36.
- JP lines fail for the ordinary reason (JP model, but short repetition-heavy lines like
  L34/L37 `連れ行くその場所は` come back cov=null when the repeat retargets).

**Implication for the success bar:** stranger's low `measured` (20 word / 14 segment) is
driven by (a) the 5 interjection lines, which should be excluded as un-scoreable, and (b)
repeated-chorus lines whose LCS anchor is stolen by an earlier identical occurrence — a
*repeat-disambiguation* problem, not an EN-tokenization problem. The corpus median `needs_rev`
is ~2 (well-matched songs); stranger's 26 is ~13× that, far outside the spec's ≤1.5×-median
target. Meeting that target requires the repeat-occurrence matcher to place later chorus
copies, and the interjection lines to be formally carved out — it is not achievable by
boundary tuning alone and should be scoped as a matching task, flagged for Task 8/9.

## Appendix — attribution method

Pass-2 tuners were bisected by wrapping the chain (phraseAlignment.ts:1430–1445) in a
`SKIP_TUNER`-gated pass-through and replaying the probe lines with each tuner (and small
combinations) disabled. The gate was reverted after measurement; `git status` on
`src/lyrics/phraseAlignment.ts` is clean. Findings D1/D2 reproduce with a single-tuner skip;
D3 defects persist with *all* tuners disabled (⇒ projection/pass-1 stage).

## Accepted trade-offs (Task 8 fix loop)

The D1/D2/midword fixes (a90f8ed, 8e14b29, 339eeb8) plus the mid-word-end tail
extension (9e1a903) moved three non-boundary counters against the pre-fix table.
Each was investigated per line; all are surfaced-by-correct-timing artifacts,
not alignment regressions, and are accepted for the Task 9 baseline:

- **veil `read_mismatch` 2 → 3** — new token 何処 on L47 「何処かでまた会えるように」
  (now 199.53–201.92s). Whisper transcribed the sung どこかで as ここから
  (`ここ[199.44] から[199.62] また[200.06] … ように[201.40]`). Pre-fix the line's
  window missed this audio entirely, so the reconciler never saw it; the flag is
  the reconciler doing its job against a mis-heard transcript. Timing is now
  correct per the transcript shape.
- **guitar-loneliness-segment `read_mismatch` 0 → 1** — new token 螺旋 on L6
  「めまいの螺旋だ」 (now 38.19–40.85s). The segment transcript garbled the phrase
  to 「名前のなぜんだ」 (39.00–50.46s chunk). Same pattern: correct window,
  Whisper-caused reading flag.
- **stranger-than-heaven-word `align_needs_review` 26 → 27** — churn among
  repeated chorus lines: L14 "I found a place…" cleared, L15 + L53 "Tore down the
  gates…" flagged. This is the repeat-occurrence disambiguation class documented
  in §5 as out of scope for boundary tuning; net review load ±1 on a song whose
  matching needs dedicated follow-up work.

Record correction: the Task 8 report claimed veil `late_p2` 1 → 0 prematurely;
at 339eeb8 it was still 1. The mid-word-end tail extension (9e1a903) resolved it —
veil `late_p2` is 0 as of that commit, along with veil/akfg-word/guitar-seg
`midword_p2` = 0 and stranger-seg `early_p2` = 0.

## Final results (Task 9, baseline locked)

Baseline re-snapshotted over the 8-song corpus at this commit; all `bnd_*`
counters are now CI-enforced (corpus-scorecard.test.ts asserts every song has
a baseline row and no numeric counter may increase).

Boundary counters, findings table → final (pass 2):

| song | early | lateStart | late | midWord |
|---|---|---|---|---|
| veil | 0→0 | 4→3 | 1→**0** | 0→0 |
| akfg-firsttake-word | 0→0 | 0→0 | 1→1 | 1→**0** |
| akfg-firsttake-segment | 1→1 | 0→0 | 0→0 | 8→**2** |
| my-eyes-only | 2→**0** | 0→0 | 0→0 | 0→0 |
| stranger-than-heaven-word | 1→1 | 3→2 | 0→0 | 3→2 |
| stranger-than-heaven-segment | 1→**0** | 2→1 | 0→0 | 8→**2** |
| guitar-loneliness-word | 0→0 | 1→1 | 1→1 | 5→3 |
| guitar-loneliness-segment | 2→2 | 4→2 | 1→1 | 14→**0** |

Success-bar reckoning vs the design spec:
- **Met:** every pass-2-introduced defect class found in the findings (D1, D2,
  glyph-snap early ends, mid-word ends) is fixed and regression-guarded; no
  counter anywhere is worse than the findings table; my-eyes-only and veil are
  fully clean on ends.
- **Residual, documented:** the remaining nonzero counters are (a) D3
  projection-stage residuals (guitar L30/L45/L14/L15, veil lateStarts —
  survive all-tuners-off, need pass-1/projection work), (b) segment-merge
  chunk artifacts (akfg-seg L25, guitar-seg L6 — two lines share one Whisper
  chunk; carve-out class C2), and (c) stranger-than-heaven repeat-chorus
  lines (§5). None are boundary-tuner-fixable without risking the motivating
  fixes; all are locked in the baseline so they can only improve.
- **Not met, scoped out:** stranger-than-heaven's unmatched/needs_review rate
  (27/59) remains ~13× the corpus median. Root cause is repeat-occurrence
  disambiguation of identical chorus lines (first occurrence matches cleanly),
  not mixed-language tokenization. Needs dedicated follow-up work in the
  matching stage.

## Repeat-chorus matching (follow-up effort)

Follow-up to §5. The matching-stage work landed as branch `repeat-chorus-matching`
(spec: `docs/superpowers/specs/2026-07-07-repeat-chorus-matching-design.md`):
(1) fuzzy repeat detection tolerant of ad-lib parentheticals, (2) an
evidence-gated re-anchor for 2-occurrence repeat blocks (accept only when it
scores strictly better), (3) an EN-vocalization branch in
`isInterjectionLyricLine` so all-vocalization lines classify as `approximate`
(un-scoreable) instead of `needs_review`, plus an informational `unscoreable`
scorecard column.

### Before / after (stranger-than-heaven)

| counter | word: before → after | segment: before → after |
| --- | --- | --- |
| align_needs_review | 27 → **22** | 20 → **16** |
| unscoreable (new, informational) | — → 5 | — → 5 |
| align_long_dur | 1 → 1 | 0 → 0 |
| all boundary counters (bnd_*) | unchanged | unchanged |

All 7 other corpus entries are byte-identical on every numeric counter to the
locked baseline (the only baseline-file change besides stranger's two counters
is the new `unscoreable` string column, exempt from the regression guard).

### Per-line reckoning of the residual needs_review lines

The stranger fixture transcript is an alternate/live take: nearly every English
chorus and verse line is **re-sung with different words** vs the studio lyric
sheet (e.g. the sheet's "I found a place where I'm not alone / Tore down the
gates…" is sung/transcribed as "I'll find a place / made a way boy", and
"Paved my way, won't live in my past" as "made a way boy / Taking us to the
place where"). Those lines have no recoverable phonetic anchor and are the bulk
of the residual.

**Class A — transcript-garble carve-out** (sung content mis-transcribed beyond
phonetic recovery; quoted evidence is the transcript at/near the line's window):

Word mode (20 lines): 0,1,2,15,21,31,33,34,37,44,45,46,47,48,49,50,53,54,57

| row | sheet line | transcript at window (quoted) |
| --- | --- | --- |
| 0 | I found a place where I'm not alone | `(♪~) 夜 は く take yourself away` |
| 1 | Tore down the gates, took all my pain… | `夜 は く take yourself away` |
| 2 | You know I could take you somewhere, oh | `take yourself away … St range in heaven` |
| 15 | Tore down the gates… | `I found a place Oh no no no D ream and a gaze` |
| 21 | Followed by the echoes where the black light dims | `T rou ble when the angels were the lamp light D im ms` |
| 31 | 汚れだらけ痛みの果て | `observe the ends You are a daughter, get it?` (JA 痛/果 only at 66–67s, never near 123s window) |
| 33 | Tore down the gates… | `I 'll find a place Oh no, don 't let me gaze` |
| 34 | 錆ひとつない 触らせやしない 媚びる気はない | `I can 't die, I 'll find a place` (JA re-sung in EN) |
| 37 | 連れ行くその場所は | `一 つ ない 変 わ ら せ や す い 飛 び 抜 き は` |
| 44–49 | Paved my way… / Once you come here… / Pull no shot… / Stranger than heaven (bridge ×2) | `made a way boy T aking us to the place where` (the whole bridge block collapses onto this one window) |
| 50 | Pull no shot till you're part of this pack, it's | `T aking us to the place where St range in the heaven` |
| 53 | Tore down the gates… | `I know the moon So we don 't make it` |
| 54 | 錆ひとつない 触らせやしない 媚びる気はない | `喋 ら せ した い こ ぴ る 気 を` |
| 57 | 連れ行くその場所は、oh | `D en ied to a place Oh … St range over heaven` |

Segment mode (12 lines): 0,1,2,31,37,45,48,49,50,53,54,57 — same lines/evidence
as word mode where they overlap (45/48/49 are the bridge block, garbled to
`So call my pain and made a way boy / Taking us to the place where`).

**Class B — fixable-in-principle** (transcript DOES contain recognizable content
at a plausible time; matching still fails — documented follow-up list):

| row | mode | sheet line | recognizable transcript (time) | why matching fails |
| --- | --- | --- | --- | --- |
| 9 | word+seg | 滾らせるこの覚悟の血 (Hey) | `今 駆け出せる この影を呑み` (~45s, correct window) | garbled-but-adjacent JA: only `この` matches verbatim; the partial kana overlap falls below the line-scoring match threshold, so a correctly-timed line still reads needs_review. |
| 11 | word+seg | 明かりの灯し方さえ知らず | `上がりの 灯しか` (~55s, correct window) | `灯し` is literally present but is too small a matched span (< the fraction the quality classifier needs) for a multi-token JA line. |
| 29 | seg only | Under lock of death, the names still burn | `Under lock and death, some names still burn` (**119.5s**) | near-verbatim transcript exists, but the line's window is placed at 128–130s (`Oh no, don't let me gaze`); the preceding "Followed by the echoes" verse mis-anchored and pushed rows 29–30 ~9s late, and the monotonic forward search never recovers to 119s. |
| 30 | seg only | Don't read between the lines, close your eyes and observe the answer | `Don't read between the lines,,Pulled your eyes, then observe the ends` (**122s**) | strongly recognizable at 122s, but window sits at 130–131s for the same cascade reason as row 29 — a projection/window-placement failure, not a garble. |

**Class C — mis-flagged** (timing correct but scoring flags anyway): **none
found.** Every flagged line is either genuinely un-anchorable (A) or a real
placement/threshold gap (B).

Classification counts: **word A=20 B=2 C=0**; **segment A=12 B=4 C=0**.

### Effective-bar verdict

Corpus needs_review = [7,0,0,2,22,16,2,2] → median **2**, so 1.5× median ≈ **3**.
Effective residual = needs_review − class-A carve-outs:

- **Word: 22 − 20 = 2** (rows 9, 11). **2 ≤ 3 → spec bar MET** after documented
  transcript-garble carve-outs.
- **Segment: 16 − 12 = 4** (rows 9, 11, 29, 30). **4 > 3 → PARTIALLY MET** (one
  line over the bar). The two extra flags (29, 30) are the class-B
  window-placement cascade, not garble.

Honest bottom line: after carve-outs the matching-stage work brings stranger
from ~13× the corpus median to at or just above the 1.5×-median bar. The bulk of
the reduction is correctly reclassifying the 5 vocalization lines as unscoreable
and refusing to flag lines the transcript simply does not contain.

### Class-B follow-up list (next effort)

1. **Partial-JA anchor scoring (rows 9, 11):** short JA lines with a small but
   real matched span (`この`, `灯し`) still read needs_review. Consider crediting
   correctly-timed lines with any verbatim token overlap, or lowering the
   matched-fraction floor for short lines.
2. **Verse-cascade window recovery (segment rows 29, 30):** near-verbatim
   English verse lines are placed ~9s late because an upstream mis-anchor
   ("Followed by the echoes" family) advances the monotonic search past their
   true position. Needs a projection-stage back-search / re-anchor when a later
   line scores far better at an earlier unused window.

## 2026-07-09 — messy-audio robustness round

Follow-up to the Class-B list above (branch `accuracy-round-2`, commits
`fb723ff..HEAD`; plan `docs/superpowers/plans/2026-07-09-robust-alignment-messy-audio.md`,
spec `docs/superpowers/specs/2026-07-09-robust-alignment-messy-audio-design.md`). Five
work streams; two shipped, one shipped-but-inert-on-this-corpus, one reverted, one
experiment lost. All numbers below are diffed directly against the pre-round baseline
(`git show 49908af:tests/ai-pipeline/fixtures/corpus-baseline.json`, the plan-doc commit
at the branch root) and the current scorecard/`--check-baseline` run.

### C1 — degenerate-run redistribution (SHIPPED)

`src/lyrics/lineDegeneracy.ts` (expected-duration + activity-region helpers) +
`src/lyrics/redistributeDegenerateRuns.ts`, wired as the **last** timing tuner in
`refineAlignmentWithPhrases` (commits b9e7a0c, 647671b, 30d0206, 571323d, 56cbdb9).
Detects three degeneracy shapes in a run of consecutive lines:

- **pileups** — consecutive line starts <0.4s apart
- **compressions** — line duration < `minLineDuration * 0.55`
- **absorptions** — line duration > `max(18s, 2.5x expected)`

and re-times the run by packing it across transcript activity regions (gaps >4s are
excluded as real instrumental breaks) via single-pass greedy region packing, carrying
unspent budget forward so a run never strands a final sliver (56cbdb9). Also upgrades a
line from `needs_review` to `approximate` when its re-timed span overlaps real matched
words, and clamps each line to its own activity region so redistribution can never let a
line's rendered span swallow a real gap (bug found and fixed while proving the
stranger-than-heaven 39s-absorption fixture, per 571323d's commit message).

**Measured (stranger-than-heaven, pre-round baseline @ 647671b → current):**

| metric | word | segment |
|---|---|---|
| `align_needs_review` | 20 → **3** | 14 → **3** |
| `align_pileup` | 12 → **2** | 15 → **4** |
| `align_compressed` | 23 → **20** | 25 → 25 (unchanged) |
| `align_long_dur` | 1 → **0** | 0 → 0 (unchanged) |
| `bnd_measured` | 20 → 20 (unchanged) | 14 → 14 (unchanged) |

The `align_long_dur` 1→0 is the 39s-absorbed line collapsing back to a normal duration.
The two new metrics (`align_pileup`, `align_compressed`) are now part of the
baseline-guard set in `corpus-baseline.json` / `corpus-scorecard.test.ts`, so neither can
silently regress. All 7 other corpus entries are untouched by this change (byte-identical
on every numeric counter).

**Residual carve-out:** a sub-`minLineDuration` sliver is still possible when a run's
remainder lands in a disproportionately tiny *trailing* activity region — the packer is
single-pass and greedy in one direction, so it can't borrow room from an earlier region
once it's moved past it. Mitigated downstream by `expandSquashedLineHighlights`; revisit
only if this is observed on a real (non-fixture) song.

### C2a — dual-vocalist stream keep (REVERTED — no measurable gain)

Commits b02d0c7 (keep + re-sort) then 0c54817 (revert). `sanitizeTranscript` was
dropping any transcript word whose start time rewound relative to the previous word —
which discarded an entire interleaved second-vocalist word stream when present. b02d0c7
loosened the drop to only rewinds beyond a 3s tolerance, keeping smaller rewinds. Measured
regression on stranger-than-heaven-word: `align_needs_review` 3→4, `align_compressed`
20→25, `bnd_midword_p2` 2→3 — the naive keep hurt because the kept second-vocalist words
are duplicate coverage of lines already matched, which inflates the char-stream weighting
used by the phrase matcher.

A dedup refinement was then implemented and measured (not shipped): keep a rewound word
only if its span doesn't overlap an already-kept word's span (i.e., only genuine
gap-fillers survive). Measured against pre-Task-5 (56cbdb9) across the **whole corpus**:
the dedup drops all 46 duplicate rewinds + 37 large chunk-merge artifacts and keeps
exactly 1 gap-filling word corpus-wide — output is byte-identical to pre-Task-5 on every
song's every counter. Verdict: every dual-vocal overlap in the available corpus is a
doubling, not a genuine gap-filler; there's no proven payoff for the added complexity, so
0c54817 reverted to keep `sanitizeTranscript` simple. The validated dedup approach (span-
overlap keep/drop rule) is preserved in commit 0c54817's message if a fixture with a real
gap-filling multi-vocalist stream ever appears.

### C2b — phonetic anchor recovery (SHIPPED, inert on stranger)

`src/ai-pipeline/phoneticEn.ts` (consonant-skeleton similarity; digraphs are skeletonized
per-token, fixed in b4a3d9a, to avoid false matches across word boundaries; similarity
threshold 0.70) + `recoverLatinLinesByPhoneticAnchor` tuner in `phraseAlignment.ts`
(9b7ee4e), wired before redistribution in the tuner chain, with an ownership guard: only
skip recovery when the *previous* line has a real lexical span that would be compressed
below `minLineDuration * 0.55` by the recovery; a no-span neighbor never blocks (guard
fix in 8a95b09 — the initial guard over-blocked whenever the previous line lacked a span
at all).

Proven correct end-to-end by synthetic integration tests covering positive recovery, the
threshold-gate negative case, and both guard branches
(`tests/ai-pipeline/phoneticRecovery.integration.test.ts`).

On the real stranger-than-heaven fixture it is **inert**: the one real candidate line —
row 21, "Followed by the echoes where the black light dims" (misheard by Whisper as
"Trouble when the angels were the lamp light dims", similarity 0.703, matched window
100.08–102.02s) — remains blocked by the pre-existing class-B mis-anchoring of row 20
("Stranger than heaven", placed at 100.10–101.80s vs its true matched span 97.98–99.82s,
per the Class-B follow-up list above). The upstream mis-anchor claims row 21's rightful
window before phonetic recovery ever gets a chance to act on it. Fixing that class-B
repeat-occurrence defect would unblock this recovery. The corpus baseline is unchanged by
C2b (expected and deliberate — this is a targeted, currently-dormant capability, not a
metric-moving fix).

### C3 — mixed-language auto-detect transcription (EXPERIMENT LOST — Task 10 skipped)

Commits a912eb7 (experiment + verdict), 034caab (retry with the language key omitted
instead of passed as `null`, per the design spec's literal wording). The garbled EN
sections in stranger-than-heaven were confirmed rooted in forced single-language (JA)
Whisper decoding — but per-chunk auto-detect via `@xenova/transformers` turns out to be
broken at the library level, not merely a quality tradeoff. With `chunk_length_s: 30`,
`stride_length_s: 5`, an auto/omitted language produces a deterministic, severely
truncated transcript: word mode covers only 40.0–88.2s of the 231s song (123 chunks vs
557 for forced-JA covering 0–231s); segment mode covers only 43–83.7s (18 chunks, last
chunk has a null end timestamp, vs 63 chunks covering the full song for forced-JA). The
two commits are byte-identical transcripts — explicit `null` vs omitting the key entirely
made no difference, ruling out a null-vs-undefined config bug; the truncation is a
long-form chunking defect in this version of the library when combined with per-chunk
auto language detection.

**Measured (through the improved aligner, forced-JA → autolang):**

| metric | word mode | segment mode |
|---|---|---|
| `align_needs_review` | 3 → 7 | 3 → 1 |
| `align_pileup` | 2 → 9 | 4 → 10 |
| `align_compressed` | 20 → 59 | 25 → 59 |
| `bnd_measured` | 20 → 1 | 14 → 0 |

`bnd_measured` collapsing to ~1 line means the aligner falls back from `content` mode to
`proportional` mode for both autolang rows (almost no transcript text left to anchor
against), which is why `align_compressed` blows out to near-total. **Verdict: LOSES.**
Task 10 (wiring auto-detect into the app) was skipped per this result. The autolang
fixtures are kept in the corpus as evidence (`stranger-than-heaven-word/segment-autolang`
rows in the scorecard, both `mode: proportional`) rather than deleted. Future paths if
revisited: upgrade or replace `@xenova/transformers`, or do manual audio windowing with
an explicit per-window forced language instead of relying on the library's auto-detect.

### Where stranger-than-heaven stands now (word mode)

Current scorecard row: `align_needs_review=3, align_pileup=2, align_compressed=20,
align_long_dur=0, unscoreable=5, bnd_measured=20`. Segment mode:
`align_needs_review=3, align_pileup=4, align_compressed=25, align_long_dur=0,
unscoreable=5, bnd_measured=14`.

Net movement this round: `needs_review` 20→3 (word) / 14→3 (segment), `pileup` 12→2 /
15→4, `long_dur` 1→0 (both modes) — the six-line 153.88–154.18s bridge pileup and the 39s
absorbed line documented in the repeat-chorus-matching section above are both gone, fixed
by the C1 redistribution pass rather than by any matching-stage change.

This refines rather than overturns the earlier "alternate take" theory from the
repeat-chorus-matching section: a meaningful share of the EN "garble" turns out to be
forced-JA decoding compounding Whisper's mishearing (per C3), not purely a sung-vs-sheet
discrepancy. The sheet-vs-sung gap genuinely remains for parts of the bridge (Class-A
carve-outs, unchanged by this round), but the aligner now degrades gracefully around it —
no more pileups, no more multi-line time-absorption — instead of visibly breaking.

### Post-review addendum (2026-07-10)

The whole-branch review surfaced one Important interaction defect, fixed in `1bb48a7`:
`redistributeDegenerateRuns` judged "anchored" purely by lexical score, so a
phonetically-recovered line (lexically needs_review by definition) inside a still-degenerate
run was re-timed off its evidenced audio while the stale `recovered` mask still upgraded it
to `approximate`. Fix: recovered lines are passed to redistribution as an `anchoredMask`
(run boundaries), the phonetic quality upgrade is invalidated for any line redistribution
moved, and phonetic recovery is now gated on `content`-mode alignment — in `proportional`
fallback the entire layout is interpolation, so pinning a single line to a phonetic hit
only distorts the uniform scale around it (observed as a real regression on the
word-autolang fixture before the gate).

Known residual edges (all currently unreachable on real fixtures, candidates for a future
hardening pass): (1) redistribution's greedy packing can still leave a sub-min sliver in a
disproportionately tiny trailing activity region; (2) the phonetic tuner's
`enforceLineMonotonicity` can clip a recovered line's end when the *next* line's stale
interpolated start sits inside the anchor span (it pulls back the previous line's stale
end but doesn't push the next line's start).
