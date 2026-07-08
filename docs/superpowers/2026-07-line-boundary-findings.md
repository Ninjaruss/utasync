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
