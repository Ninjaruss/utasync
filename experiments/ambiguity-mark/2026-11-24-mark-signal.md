# Spike: a better signal for the ambiguity mark

**Written before the first arm was run** (CLAUDE.md rule 3). Time-box: one day.
Nothing enters `android/` unless the gate below passes.

## The question

Furigana must never assert a reading it cannot know (spec 4.2), so a word whose surface is read
more than one way is marked. The predicate today is `Ruby.isAmbiguous`, i.e. "the alternates asset
lists a reading for this surface other than the one shown". Task 7 put that mark on a screen for
the first time and it fires often enough to read as decoration rather than a warning.

Is there a signal that fires on the words whose reading is genuinely unknowable here, and not on
the rest?

## The instrument, and what it is worth

`auditAgainst` over all 46 corpus entries (99 words), reporting the two counters added in L55:

- `overmarkedAlternates` — corpus lists no alternates, the ruby carries some. **Baseline 18.**
- `unmarkedAlternates` — corpus lists alternates, the ruby carries none. **Baseline 5.**
- `right` — reading and sense both correct. **Baseline 89**, a two-sided ratchet.

Measured from the baseline before writing this: 35 of the 99 corpus words have genuine alternates,
so the mark is *supposed* to fire on about a third of them. Marked today: 30 true + 18 false = 48.
**Precision 30/48 = 62.5%, recall 30/35 = 86%.** The mark is already right more often than wrong,
which sets the bar: a signal that cannot visibly change how often it lies is not worth the
machinery.

The counters pull in opposite directions and mean nothing alone — suppressing the mark everywhere
drives `overmarked` to 0 and `unmarked` to 35 — so the gate constrains both.

**What this cannot tell us:** every corpus entry is `"kind": "unverified"`, so both counters measure
agreement with an unverified expectation, not with truth. A passing arm is a candidate for the
owner's review, not a certified improvement. The gate is therefore about the *size* of the effect,
not its last unit.

## The gate

**PASS** requires all three:

1. `overmarkedAlternates` ≤ 9 — at least half of the 18 false marks gone, taking precision from
   62.5% to at least 77%.
2. `unmarkedAlternates` ≤ 5 — **no true mark lost.** Recall may not be traded for precision: a
   reading asserted as certain when it is not is the defect the mark exists to prevent.
3. `right` == 89 — the arm changes which words are marked, nothing about readings or senses.

**NO-GO** otherwise. The arm is recorded here either way, and on NO-GO the harness is deleted and
nothing is added to `android/`.

Each arm is judged on its own. "The best of five arms" is not a pass.

## The arms

Scored over the same corpus, one predicate each, replacing "the asset lists another reading".

- **A — common only.** The rival must be in the asset's *common* list (the asset is
  `{surface: [[common], [uncommon]]}`; the parser unions them today, deliberately).
- **B — the rival is a standalone word.** Drop a rival whose only dictionary entries for that
  surface are suffix, prefix or counter class (`pos` in `suf`/`pref`/`ctr`). 店/てん is a suffix;
  店/たな is a noun. Named in ledger L55.
- **C — the rival is the same word, said differently.** Drop a rival whose first gloss for that
  surface equals the shown reading's first gloss: 先生 せんせい/せんじょう/せんしょう are all
  "teacher; instructor; master", and 道 みち/どう are both "road; path; street". Marking those tells
  the reader nothing about meaning. **Not named in L55** — it came from reading the dictionary rows
  while building the harness.
- **D — the tokenizer agrees with the dictionary's first entry.** Do not mark at all when
  Kuromoji's chosen reading is the first entry listed for that surface. Named in L55.
- **B+C** — the conjunction of the two that the data suggests are strongest.

JMdict frequency and priority tags were the third candidate L55 named. They are **not available**:
`public/jmdict-popover.json` carries `r`, `pos` and `g` per sense group and no frequency field, and
`public/jmdict-readings.json` carries only the common/uncommon split that arm A already tests.
Recorded as unavailable rather than silently dropped.

## Result — NO-GO on all five arms

Harness: `MarkSignalSpike`, run from `:japanese` test sources and kept here as
`MarkSignalSpike.kt.txt` rather than in `android/` (NO-GO ⇒ nothing enters it), with the copy-in
command in its header. **Validity check first:** arm 0 reproduces the baseline exactly, 18 / 5 / 89, so
the harness is scoring the same thing `audit-baseline.json` records.

| arm | overmarked | unmarked | right | verdict |
| --- | --- | --- | --- | --- |
| 0 baseline | 18 | 5 | 89 | — |
| A common only | **5** | 17 | 89 | FAIL (clause 2) |
| B standalone word | 17 | 7 | 89 | FAIL (clauses 1 and 2) |
| C not the same word | 16 | 9 | 89 | FAIL (clauses 1 and 2) |
| D tokenizer took the first entry | 8 | 27 | 89 | FAIL (clause 2) |
| B+C | 15 | 12 | 89 | FAIL (clauses 1 and 2) |

`right` is 89 in every arm, as expected: these predicates touch only which words are marked.

### Every arm trades recall for precision, and three do it worse than chance

The yardstick: 48 words are marked today, 30 of them rightly and 18 wrongly. A predicate that
deleted marks *at random* would therefore lose 30/18 = **1.67 true marks for every false one it
removes**. Measured cost per false mark removed:

| arm | false removed | true lost | true lost per false removed |
| --- | --- | --- | --- |
| A common only | 13 | 12 | **0.92** |
| B standalone word | 1 | 2 | 2.0 |
| C not the same word | 2 | 4 | 2.0 |
| D tokenizer took the first entry | 10 | 22 | 2.2 |
| B+C | 3 | 7 | 2.33 |

**Only arm A carries information at all** — it is about 1.8× better than chance, and still costs
very nearly one true mark per false one. B, C and D are each *worse* than deleting marks at random,
which is the finding: a rival reading's part-of-speech class, whether its gloss matches the shown
reading's, and its position in the dictionary's entry list carry **no usable signal** about whether
that rival matters here. The two populations look the same through these features.

### Two things the gate was not looking for

1. **`unmarkedAlternates` conflates two different failures.** 3 of the 5 are words the analyzer
   never returned at all — 一人, 二人 and 後, the IPADIC segmentation disagreements Task 6 already
   recorded (一人 → 一/人, 後 → 後で). Only **2** are genuine missing marks (本気 and 手). The
   counter should separate "not marked" from "not matched" before anyone tunes against it.
2. **7 of the 18 false marks name the word's own reading as its rival.** 降っ is shown ふっ and
   marked because 降る is read ふる — in dictionary form, so the string never equals the surface
   reading and the shown reading is never filtered out. Same for 寒かっ (さむかっ / さむい), 言っ
   (いっ / いう), 行か, 行っ, and 来 twice (こ and き / くる). The popover shows that rival list to
   the reader, so this is wrong *content*, not just a count: "also read ふる" over a word already
   read ふっ. 時 (じ / とき) and 何 (なん / なに) look the same in the output but are genuine
   homographs, where the base form and the surface are the same word with two readings.

   Removing the self-references clears **no marks at all** (降っ still has くだる, 言っ still has
   ゆう, 来 still has きたる), so it is not a fix for this gate — it is a separate defect in what
   the popover says, fixable and testable on its own, and it needs no signal.

### Why this is where the thread stops

The mark's precision is 62.5% and its recall 86% against this corpus, and nothing in the available
data separates the false marks from the true ones. Several of the 18 are also arguably *correct*
marks that the corpus calls wrong — 時 genuinely reads とき, 水 genuinely reads すい — and every
corpus entry is still `"kind": "unverified"`. So the limit here is the expectation, not the
predicate: **the owner's verification of the 35 alternate lists is on the critical path**, and until
it exists a better signal cannot be told from a better-fitted one.
