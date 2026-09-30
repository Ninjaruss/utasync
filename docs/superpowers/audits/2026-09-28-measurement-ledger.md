# Measurement ledger

**Created:** 2026-09-28 (plan item W0.8,
`docs/superpowers/plans/2026-09-28-automatic-sync-accuracy.md`)

Every number that a threshold, a policy decision, or a piece of user-facing copy rests
on gets an entry here: **what was measured, by what instrument, whether it is
reproducible from the repository, and what requirement it serves.** Refutations are
appended, never silently replaced — because this project's own history is that
*"every prior round that shipped a threshold on judgement had it later refuted by
measurement"* (`docs/superpowers/audits/2026-08-18-version-aware-sourcing.md:12`).

## Rules

1. A threshold set to an *observation* is not a requirement. Label which it is. When a
   bound is set to the current measurement, say so and say what the real target is.
2. An entry marked **UNSOURCED** is a claim without a measurement. It may not be cited to
   justify refusing to change behaviour. Either reproduce it, or withdraw it.
3. An entry marked **CONTRADICTED** means a later measurement disagrees. Keep both, with
   the conditions under which each holds — do not delete the loser.
4. Instruments that assert nothing (print-only scripts) do not qualify as sources.
   `scripts/audit-vs-lrc.mjs` was print-only until 2026-09-28; it now also drives
   `tests/ai-pipeline/lrc-truth.test.ts`.

---

## Entries

### L1 — "LRCLIB timings are typically about a second out (median 0.24–0.73 s after one constant shift)"

- **Cited at:** `src/core/types/index.ts:170-177` (`timingSource` doc) and
  `src/player/alignmentPolicy.ts:29-43`, where it is the stated basis for refusing to
  auto-align already-timed lyrics.
- **Instrument:** none found. `grep -rn '0.24\|constant shift' docs/` returns nothing; no
  audit, plan, spec, or test records it; `git log -S` finds no commit introducing the
  estimators it also refers to.
- **Status:** **UNSOURCED.** Reproducible from the repository: no.
- **Why it matters:** this single unverified number suppresses the automatic path for the
  most common real case (a song whose lyrics came back from LRCLIB already timed), which
  is the capability the plan exists to build (see plan §0 and W1.2).
- **Action:** reproduce it against `scripts/align-mode-choice.mjs`-style instrumentation
  plus a timed fixture, **or** withdraw it and revisit `alignmentPolicy.ts:42`. Until then
  it must not be the reason no verification runs on timed lyrics.

### L2 — "Two Whisper-free estimators were measured and both missed by ~0.8 s"

- **Cited at:** `src/player/alignmentPolicy.ts:33-35`, immediately after L1, as the second
  support for the same policy.
- **Instrument:** none found; the estimators themselves are not in the tree.
- **Status:** **UNSOURCED.** Reproducible: no.
- **Note:** the plan's W1.2 Layer 1 does not depend on this being wrong. It depends on the
  estimator being *corroborated* by per-line onset structure and escalating when it cannot
  be — which is a different design from the two bare estimators this entry refers to.

### L3 — word timestamps: mean |err| 5.61 s / p90 16.90 s / 29 lines >3 s; segment: 0.74 s / 1.71 s / 1 line

- **Cited at:** `src/ai-pipeline/alignTimestampMode.ts:9-29`, justifying the shipped
  constant `'word'` on every transcribing tier.
- **Instrument:** unnamed in the comment; described as "the isolated vocal stem of
  tests/e2e stranger-than-heaven (same audio, same lyrics, same whisper-small — mode is the
  only difference)".
- **Status:** **SOURCEABLE but not reproducible from the repository** — the stem
  (`public/e2e/*.f32`) and the e2e audio are gitignored, and the script that would produce
  the numbers (`scripts/e2e-align-stem.mjs`) prints and asserts nothing.
- **CONTRADICTED on a different audio source, 2026-09-28** by
  `scripts/align-mode-choice.mjs` on the committed **mix** fixtures:

  | stranger-than-heaven config (mix) | verdict | absP90 | absWorst | no-evidence lines |
  |---|---|---|---|---|
  | word two-pass (the app path for this mixed sheet) | 0.729 | **4.13** | 9.16 | 30 |
  | segment two-pass | 0.729 | 6.50 | 12.35 | 27 |
  | segment medium | 0.729 | 8.36 | 12.35 | 21 |
  | word ja-only (not an app path) | — | **34.72** | 36.80 | 34 |

- **Reconciliation:** both are real and they are not in conflict — mode quality depends on
  the audio source. Word mode loses badly on the stem and wins on the mix; the reverse
  holds for recollect (verdict 0.453 word vs 0.736 segment; truth absP90 13.50 vs 6.04).
  A constant therefore cannot be right for every song, whichever value it picks.
- **Serves:** plan W1.1. Implemented as one automatic escalation under accept-if-better
  (`src/ai-pipeline/alignModeChoice.ts`), not as a changed constant — the constant remains
  the first rung.

### L4 — tap latency is "roughly 250–400 ms, and always in the same direction, late"; tapping ~4 flagged spots left 0.30 s mean start error, worst 0.82 s

- **Cited at:** `src/player/DragRetimeStrip.tsx:45-58`, justifying drag-to-retime over
  tap-to-commit.
- **Instrument:** "measured on a real song" — not named, not in the tree.
- **Status:** **SOURCEABLE but not reproducible from the repository.**
- **Serves:** the plan's perceptual contract C2. The 0.82 s worst line is the tightest
  product-side accuracy figure in the codebase, which is why C4 (worst line ≤1.0 s) is
  anchored near it rather than invented.

### L5 — labels catch 22 of the 41 'good' lines that start >1.5 s from truth

- **Cited at:** `src/lyrics/labelHonesty.ts:19-22`.
- **Instrument:** "Ground truth (LRC + caption onsets over the audit corpus)" — i.e.
  `tests/ai-pipeline/fixtures/lrc-truth/*` plus the AKFG caption onsets.
- **Status:** **SOURCED** (in-code), reproducible in kind.
- **Serves:** plan S7/W2.2. It is recorded here because it is a 54 %-recall detector being
  described in-code as a success; the recall number is the requirement to improve, and W2
  asks for it to be measured and asserted rather than restated.

### L6 — vocal isolation cost 15.4 s mean error against 2.8 s on the mix; 0 of 30 rows verified against 21

- **Cited at:** `src/ai-pipeline/stemQuality.ts:80-88` and
  `AutoAlignFlow.tsx`'s post-transcription stem guard.
- **Instrument:** live run on AKFG "Rock'n'Roll, Morning Light Falls on You" (THE FIRST
  TAKE).
- **Status:** **SOURCEABLE but not reproducible from the repository** (copyrighted audio,
  untracked).
- **Serves:** the existing stem-fallback guard, and plan W1.5 (per-song isolation
  decision). It is the reason "isolation is on by default" is safe, and the reason a
  per-song decision is worth building.

### L7 — absolute truth error, 2026-09-28 baseline (the plan's Phase 1 numbers)

- **Instrument:** `npx tsx scripts/audit-vs-lrc.mjs`, asserting via
  `tests/ai-pipeline/lrc-truth.test.ts` (9 configs). Formula in
  `scripts/lib/lrcTruth.mjs` (`scoreAgainstTruth`).
- **Status:** **SOURCED and reproducible.**
- **Serves:** the gate. Measured: guitar word absP50 0.29 / p90 1.93 / worst 2.55, offset
  +0.31 s (version-exact, so this offset is ours); guitar segment 0.39 / 2.29 / 5.83,
  offset +0.36; veil 0.26 / 0.98 / 1.91, offset −0.02; recollect 1.77 / 6.04 / 8.30,
  offset +0.15; stranger configs 1.20–2.15 / 4.13–34.72, offset +1.20…+1.40 (its LRC is a
  237 s edit of our 233.57 s audio, so much of that offset is a version difference).
  Only 44 % of guitar-loneliness word lines land within 250 ms.
- **Note:** the thresholds in `lrc-truth.test.ts` are these values plus ~10 % — they are
  ratchets, **not** requirements. The requirements are C1–C4.

### L8 — mode-selection thresholds (`alignModeChoice.ts`)

- **Instrument:** `scripts/align-mode-choice.mjs` (verdict vs truth, per mode, per song).
- **Status:** **SOURCED and reproducible.**
- **Serves:** plan W1.1. `MODE_ESCALATION_MIN_UNVERIFIED_SHARE = 0.2` is calibrated
  between the "already fine" case (guitar-loneliness: 7 of 47 = 15 %, and word mode IS the
  better mode there) and the doubtful ones (stranger 47 %, recollect 81 %).
  `MODE_ESCALATION_MIN_GAIN = 0.02` exists so a tie or a marginal gain keeps the run
  already in hand.

### L10 — global-offset estimator gates (`offsetEstimate.ts`)

- **Instrument:** `tests/ai-pipeline/tierA.audio.test.ts` (real committed audio, Tier A)
  plus `tests/ai-pipeline/offsetEstimate.test.ts` (constructed signals).
- **Status:** **SOURCED and reproducible.** The Tier A clips are generated from this
  repo's own code by `scripts/make-tier-a.mjs`, so they can be committed and re-derived.
- **Measured:** with a known 0.48 s lag planted in the claimed starts, the estimator
  recovers it to within **0.030–0.050 s** on all five unmasked clips — inside the
  perceptual contract's C1 (100 ms). On the clip whose carrier is masked inside the
  vocal band it returns **no estimate** (correct refusal). The gates are set from those
  measurements, not chosen:
  - `MIN_MEDIAN_RISE = 0.15` — measured 0.65–0.87 for carriers audible in the band,
    **0.023** for a masked one. Two orders of magnitude, so the margin is not delicate.
  - `MAX_SHIFT_SEC = 0.75` — identifiability, not cost. Onsets are ~1.4 s apart, so a
    1.4 s shift lands claimed starts on the *next* onset and scores equally: measured, a
    true −0.48 s and a spurious −1.84 s both scored a 0.857 median rise at a 1.00 onset
    share. Restricting the range to below half a line's spacing removes the ambiguity;
    anything larger is a version mismatch the caller must escalate.
  - `ALREADY_CONSISTENT_SEC = 0.08` — inside this, the estimator refuses, because
    shifting timings that already fit the audio is damage for no gain.
- **Serves:** plan W1.2 Layer 1, and the D3 decision to replace the unsourced policy at
  `alignmentPolicy.ts:42` with a cheap acoustic screen.
- **CAVEAT, and it is the important part:** this validates the estimator on *synthesized*
  carriers, which have onsets but no words. It says nothing about how the estimator
  behaves on real singing under real instrumentation. That requires the user's own
  recordings (Tier A `pendingUserRecordings`, plan W0.5) and is NOT claimed here.

### L11 — "a late ramp from line #31 onward (+24 s decaying to +2 s)" (the word-mode claim)

- **Cited at:** `src/ai-pipeline/alignTimestampMode.ts:9-29`, as the explanation for the
  word-mode failure and the reason segment mode is the recovery.
- **Instrument:** claimed to be the isolated vocal stem of the e2e fixture. That stem is
  **not in the repository** (`public/e2e/` is gitignored), and the script that would
  produce the number (`scripts/e2e-align-stem.mjs`) prints and asserts nothing — so the
  claim was unverifiable by anyone else.
- **Status:** **NOT REPRODUCIBLE from the repository**, and **REFUTED for committed
  data.** `scripts/align-drift-profile.mjs` (built for this, and now the gate for plan
  W1.1.1) fits a robust Theil-Sen drift on evidence-backed lines only:
  guitar word −0.007 s/line (−0.31 s across 45 lines), guitar segment +0.005, stranger
  word ja-only −0.010 (−0.55 s across 55), stranger word two-pass (the app path) −0.008,
  stranger segment two-pass 0.000, veil +0.001. **Nothing reaches the 1 s-across-the-song
  threshold where drift would be worth acting on.**
- **What the first version of the instrument got wrong, recorded because it is the
  pattern this ledger exists to catch:** least-squares on the same data reported
  −0.209 s/line for stranger word ja-only and −0.092 for recollect. Both were artefacts —
  the first driven by a single −36.8 s line, the second fitted to 10 points. A robust
  estimator plus a minimum-n floor and a total-magnitude threshold replaced it, and
  recollect now reports NOT FITTED instead of a number.
- **The real mechanism at stranger #31–#50:** those lines' signed error swings to −1…−3 s
  while their matched-span coverage is BELOW the evidence floor. They are interpolated
  across the alternate-take evidence desert (L3/L5's fixture problem), not carried by a
  drifting transcript clock.
- **Consequence for the plan:** **W1.1.1 (transcript ramp repair) is blocked, not
  pending.** A repair for a drift that cannot be demonstrated in any fixture has no
  instrument that could verify it, which is precisely the failure mode the accuracy plan
  exists to break. Do not implement it until committed audio (W0.5) makes the ramp
  measurable — or shows it is not there at all.

### L14 — the truth-free trust verdict: what it can and cannot certify

- **Instrument:** `scripts/align-trust-calibration.mjs` (against LRC truth) and
  `tests/ai-pipeline/alignmentTrust.test.ts` (contract). Module:
  `src/ai-pipeline/alignmentTrust.ts`.
- **Why it exists:** the product intent is "when there are no timed lyrics, the aligner
  does its best and is then AUTO-CORRECTED until the sync is accurate". A correction loop
  needs an acceptance test that works at runtime, where there is no answer key. The shipped
  per-line labels are not it — they are demotions tuned for zero collateral, catching 22 of
  41 known >1.5 s errors (L5).
- **Status:** **SOURCED.** The text half is reproducible from committed fixtures; the
  acoustic half needs `public/e2e/` audio (copyrighted, uncommitted) and is therefore
  **developer-run only**, like L3/L4/L6.
- **Measured, pooled over 8 configs, per tier, against truth:**

  | tier | n | p50 | p90 | worst | within 0.5 s |
  |---|---|---|---|---|---|
  | verified | 11 | 0.31 | **1.91** | **2.55** | **55%** |
  | weak | 258 | 0.94 | 2.88 | 12.35 | 35% |
  | unverified | 122 | 2.10 | **8.74** | 20.60 | 13% |

  Verified p90 is **4.6x** better than unverified, so the tiers genuinely rank true accuracy.

- **FINDING 1 — a text-only verdict cannot certify anything.** Built on transcript evidence
  alone it put **145** lines in `verified`, whose worst member sat **12.35 s** from truth,
  at 40% within 0.5 s. The line sat exactly on its own matched evidence; the *evidence* was
  12 s wrong. This is blindspot S2 reappearing inside the very module meant to detect
  misalignment, and it is the same root cause as the labels' 54% recall: text evidence
  validates an alignment against the **transcript**, never against the **recording**.
- **FINDING 2 — acoustic corroboration is what fixes it, and it is not optional.** Adding a
  single check — does vocal energy RISE across the line's start (the same statistic
  `offsetEstimate` uses, so the two modules agree on what an onset is) — moves the top tier
  to **11 lines, worst 2.55 s, 55% within 0.5 s**. The 12.35 s line is correctly demoted.
  The gate is strict: on guitar-loneliness it cuts 26 verified to 5, and on four configs to
  zero. Part of that strictness is the **mix** envelope, which the code itself calls the
  weaker source; a stem envelope would be a fairer test and is the next measurement.
- **FINDING 3 — no config converges, and that is a statement about the pipeline, not the
  threshold.** `converged` fired **0/8**, including veil, which is the *good* case (p90
  0.98 s, zero lines over 2 s). The threshold was deliberately left where it is: loosening
  it until it says yes is the threshold-laundering this ledger exists to catch. Consequence
  for the product intent: a correction loop **cannot terminate on quality today**. It must
  iterate while the verdict IMPROVES (`isBetterAlignment`) and report the residual
  honestly. The levers that would make convergence reachable are measured, not guessed:
  L12 (prior reconciliation, 8/8), L13 (medium's coverage: −7 no-evidence lines), the
  mode escalation already shipped, and a stem-quality envelope.
- **PRODUCT IMPLICATION, and it matters for copy.** "A line called verified is within 0.5 s
  55% of the time" is the reliability figure any UI would be claiming if it labelled rows
  `verified`. **55% is not good enough to show a user as an assurance.** The tiers are fit
  for *targeting repairs* and for *internal* accept-if-better decisions; they must not be
  surfaced as a per-line promise until the top tier is materially tighter.

### L15 — the stem envelope, and the two gates that cap convergence

- **Instrument:** `scripts/align-trust-calibration.mjs` (mix and stem sections).
- **Status:** **SOURCEABLE but not reproducible from the repository** — the stems
  (`public/e2e/*.vocals44k.f32`) are copyrighted and uncommitted. Numbers recorded, audio
  untouched, same rule as L3/L4/L6/L14.
- **Measured, same 4 configs (stranger x3 + veil), so the sources are comparable:**

  | acoustic source | verified n | p50 | p90 | worst | within 0.5 s |
  |---|---|---|---|---|---|
  | mix envelope | 6 | 0.75 | 1.91 | 1.91 | 33% |
  | **stem envelope** | **33** | 0.64 | 1.91 | 2.65 | **45%** |

  My hypothesis was that a stem would *tighten* the top tier. It does not — it **widens
  recall 5.5x at equal p90**. Both figures matter and the honest reading is the second one:
  a convergence signal needs lines it can actually verify, so the stem is the better source
  for a correction loop even though it is marginally noisier at the tail. (An earlier
  version of this table compared 4 stem configs against 8 mix configs, which was not a
  comparison at all; corrected before recording.)
- **FINDING — convergence is capped by TWO independent gates, and blending them hid the
  difference.** A line the transcript never reached can never be verified, however good the
  audio is, so measuring the verified share over all lines made convergence unreachable on
  any song with transcript holes — while holes are this corpus's dominant error term.
  Measured against a 70% share / 25% no-evidence requirement:

  | config | verifiedShare | noEvidenceShare | binding gate |
  |---|---|---|---|
  | veil word | 14% | 17% | **placement** (coverage is fine) |
  | stranger word two-pass | 3% | 41% | both |
  | stranger segment two-pass | 0% | 41% | both |
  | stranger segment-medium | 0% | 27% | both |

  So `verifiedShare` is now measured over ELIGIBLE lines with `noEvidenceShare` reported and
  bounded separately. That is not moving the goalposts: it separates "the transcript never
  reached this line" — a coverage problem that gap re-transcription or a better model
  addresses (L13) — from "the placement is not supported", a placement problem. Blended,
  no amount of placement work could move the number.
- **Still 0/8 converged**, for named reasons rather than one opaque shortfall. The levers
  are therefore specific: coverage work on the stranger/recollect configs (L13, gap
  recovery), placement work on veil.

### L19 — end-to-end: the echo is REJECTED by the shipped splice (L18's inference refuted)

- **Instrument:** `spliceGapAlignment` itself, called with a real prompted transcription —
  not a hand-rolled window. Real `whisper-small` via `scripts/lib/nodeWhisper.mjs`.
- **Status:** sourceable, developer-run (real audio + real model, both uncommitted).
- **Measured.** stranger-than-heaven, the largest detected hole `[39..44]` (a 25.0s slice,
  six-line prompt, all six lines at 0.00-0.58 evidence coverage before):

  | candidate | result |
  |---|---|
  | **prompted** (echo) | **accepted = false** — the echo returned DEGENERATE character-level chunks (`a`,`h`,`h`,`o`,`o`… with no usable timing), so `placementRealizesCoverage` rejected it |
  | unprompted | accepted = true |

- **So L18's inference was wrong and is withdrawn.** The backstop is
  `placementRealizesCoverage` in `gapRealign.ts` — the comment in `gapReanalyze.ts` claiming an
  echo "is still caught by accept-if-better below" is **accurate**, and the edit I made on the
  strength of L18 has been reverted to a correct statement. Fifth claim of my own that
  measurement overturned, and the second in two rounds.
- **What L18 still establishes:** the echo is real *at the transcription level* — verbatim,
  coverage 0.00 -> 1.00, including on a window Whisper itself labels non-vocal. The backstop is
  therefore a load-bearing check against a demonstrated failure, not a theoretical one, and it
  must not be weakened or replaced with anything that measures coverage of the prompt text.
  Why it held here (k character-level tokens rather than repeated whole lines) is not fully
  understood, and a different slice length or prompt shape could produce an echo whose timing
  is *not* degenerate. That is an open risk, not a closed one.
- **A separate suspicion the same run raised, INVESTIGATED AND NARROWED TO NOT-A-DEFECT.** The
  *unprompted* splice was accepted while placing five of six lines on the identical start time
  157.30s. I first recorded that as a defect ("gated on a fall in `needs_review` though the
  placement corroborates nothing"). Checking it properly at the layer where the claim lives:

  - The pass does **not** treat pileups as defects in general: `tests/lyrics/gapRealign.test.ts`'s
    own `badAlignment()` fixture is a pileup (GAP1 at 14.0, GAP2 at 14.1) and the suite asserts a
    clean re-transcript may be spliced over it. So "the candidate is a pileup" cannot be the
    rejection test without rejecting the pass's existing legitimate cases.
  - Corroboration across the six affected lines went **1.02 -> 0.96** — i.e. roughly unchanged,
    inside noise.
  - Net: the acceptance moved those lines to where their (weakly) matched words are. Whether that
    is worse than the interpolated spread it replaced is **unmeasured**, and a pileup guard would
    therefore be an unmeasured threshold of exactly the kind this ledger exists to prevent.

  Status: **not a defect on the evidence available.** Do not add a pileup guard to the splice
  acceptance without a measurement showing the pileup harms the listener more than what it
  replaced. (Item 3's calibrated verdict is the more promising place to act on pileups, because
  it grades lines rather than vetoing whole splices — and it already flags them as unverified.)

### L18 — lyric-prompt biasing FABRICATES, and the acceptance test cannot tell

- **Instrument:** real `Xenova/whisper-small` from Node via `scripts/lib/nodeWhisper.mjs`,
  extended to mirror the app's prompt path exactly (`decoder_input_ids` from
  `buildWhisperPrompt`, ISO language code for the prompt and the full name for the ASR, both
  as `whisper.worker.ts` does).
- **Status:** **SOURCEABLE, not reproducible from the repository** for the audio (real songs,
  uncommitted). Recorded because the conclusion concerns shipped code.
- **Measured, transcribed twice per window — unprompted vs prompted with the sheet line:**

  | song / line | unprompted | prompted | sheet coverage |
  |---|---|---|---|
  | stranger #43 | `(♪~)` — Whisper hears **nothing** | `(Hey) Oh, alright(お疲れ様でした)` | 0.00 -> **1.00** |
  | stranger #41 | `(Oh yeah)×5` | `Oh, yeah (Hey)` repeated | 0.63 -> **1.00** |
  | guitar #0 | `突然降る夜が散らかささもない…` (a garbled attempt) | `突然降る夕立 あぁ傘もないや嫌` repeated | 0.46 -> **1.00** |
  | guitar #1 | `いやいや、それのご機嫌なか知らない…` | `空のご機嫌なんか知らない(音楽)` | 0.73 -> **1.00** |

  The prompt produces a **verbatim echo of itself**, and it does so even on a window Whisper
  independently labelled non-vocal. Coverage goes to exactly 1.00 in every case, fabricated
  ones included.
- **CLAIM WITHDRAWN — see L19.** I first concluded from this that the shipped comment was
  false and that accept-if-better could not catch an echo. Reproduced through the shipped
  `spliceGapAlignment` (L19), it can and did. The transcription-level echo below is real; the
  inference I drew from it about the acceptance test was not. The comment was corrected twice:
  once wrongly, then back to an accurate statement that the backstop held on the measured case.
- (Original, now-superseded reasoning follows.) **THIS MAKES A SHIPPED COMMENT FALSE:**
  `src/ai-pipeline/gapReanalyze.ts:204` prompts the slice with the sheet lyrics and its comment
  asserts *"A hallucinated echo is still caught by accept-if-better below."* It is not:
  `spliceGapAlignment` accepts on **coverage improvement** (`PLACED_COVERAGE_IMPROVE_MIN 0.1`),
  and an echo drives coverage to the maximum. So the one mechanism that is supposed to catch
  fabrication is the one it defeats.
- **Blast radius.** Gap re-transcription is not an edge path: it runs in the fresh auto-align
  and again automatically once per song on open (`shouldAutoRecoverGaps`). For a song whose
  sheet matches the recording, the echo happens to be the right words and is probably
  harmless — but it also inflates coverage, which is the primary signal in the truth-free
  verdict, so the app would then report those lines as verified on the strength of text it
  supplied itself. For a song whose sheet does NOT match (stranger's alternate take — the very
  `30 of 59` lines with no evidence), it invents anchors on non-vocal audio.
- **Consequence for plan item 2.** The design I had next — prior-guided prompted windowed
  verification — rested on the prompt making lines anchorable. It does make them anchorable,
  by echoing whatever it is told. Item 2 therefore needs an acceptance signal that is
  **independent of the prompt text** (acoustic onset support, or corroboration by an
  unprompted pass) before it can be built at all. As specified it would have manufactured the
  evidence it was supposed to be verifying.
- **Not yet changed.** The minimal correction is to the acceptance test, not to the prompt:
  a prompted splice must be corroborated by something other than coverage of the text used as
  the prompt. A one-line comment fix is included here; the behaviour change is deliberately
  left as the next deliberate step rather than made in the same breath as the measurement.

### L23 — with the harm fixed, windowed verification has NO measurable benefit (item 2 closed)

- **Instrument:** the same real-audio harness as L22 (real `whisper-small`, LRC truth), after
  gating acceptance on the WHOLE-alignment verdict (`isBetterAlignment`) rather than only the
  local splice gate, and supplying the mix envelope so acoustically unsupported lines count too.
- **Status:** sourceable, developer-run.
- **Measured, same two songs, same 8-call budget:**

  | metric | guitar before | guitar after | veil before | veil after |
  |---|---|---|---|---|
  | absolute p50 | 0.39s | 0.39s | 0.26s | 0.26s |
  | absolute p90 | 2.29s | 2.29s | 0.98s | 0.98s |
  | worst line | 5.83s | 5.83s | 1.91s | 1.91s |
  | lines within 250ms | 39% | 39% | 50% | 50% |
  | lines with NO evidence | 4 | 4 | 12 | 12 |
  | accepted / rejected | 2 / 6 | | 2 / 6 | |

  `0 better, 0 worse` — every accepted verification left the metrics untouched.
- **So the whole-alignment gate is the correct acceptance rule, and it eliminates the L22 harm
  completely** (the 13.16s catastrophe is gone, no-evidence no longer rises). It also shows that
  the harm was **entirely** caused by accepting local improvements that were globally negative,
  which is exactly what the gate now refuses.
- **BUT there is no benefit to weigh against the cost.** Eight Whisper calls per song produced two
  accepted verifications and **zero** measurable movement in any metric on either song. Item 2 is
  therefore closed as **not worth shipping**, rather than as harmful.
- **A LEAD THIS RAISES, and it is about a SHIPPED path.** The gap pass (`reanalyzeGaps` ->
  `spliceGapAlignment`) uses only the LOCAL gate — the same one L22 showed accepts globally harmful
  splices for single-line verification. Gap re-transcription runs on every fresh align AND
  automatically once per song on open, so if the local gate is equally permissive there, a shipped
  path may be moving lines for the worse. **Unmeasured**, and it needs the same real-audio treatment
  before anyone touches it. Recorded as the next measurement rather than acted on.

### L22 — verdict-driven windowed verification makes real sync WORSE (item 2 refuted)

- **Instrument:** real `whisper-small` from Node driving `verifyWeakLines` with a node-backed
  slice transcriber, scored against LRC truth. Developer-run (real audio, real model).
- **Status:** **SOURCEABLE, not reproducible from the repository** for the audio.
- **Measured, guitar-loneliness, segment transcript, 8-line budget (~26s of Whisper):**

  | metric | before | after |
  |---|---|---|
  | absolute p50 | 0.39s | 0.43s |
  | absolute p90 | 2.29s | 2.29s |
  | lines within 250ms | **39%** | **33%** |
  | lines with NO evidence | **4** | **9** |
  | evidence-backed p90 | 2.29s | 2.32s |

  `accepted = 8, rejected = 0`. Of the accepted lines that have truth — **0 better, 3 WORSE,
  1 unchanged**, and line #0 (previously 0.17s off) was moved to **1.83s** off.

- **And it generalises, worse, on a second song.** veil, same procedure, 8-line budget:

  | metric | before | after |
  |---|---|---|
  | absolute p90 | 0.98s | **1.91s** |
  | **worst line** | 1.91s | **13.16s** |
  | lines within 250ms | 50% | 50% |
  | lines with NO evidence | 12 | 12 |

  `accepted = 7, rejected = 1`; of the accepted lines with truth, **0 better, 1 worse (line #14:
  0.76s -> 13.16s), 6 unchanged**. A line that was already right was moved thirteen seconds out.
  Two songs, two independent failures, with the worst-case error moving by 7x on one of them.
- **TWO CAUSES, and the second is the serious one.**
  1. The acceptance gate measures **corroboration of the line's own text**, which a prompt echo
     maximises. L19's single case — where `placementRealizesCoverage` rejected an echo — is
     **not representative**: here the same gate accepted 8 slices and none of them helped. L19
     narrowed L18's claim; L22 shows L18's concern was right in general and L19 was the lucky case.
  2. **Splicing a single-line window replaces the transcript words across that window, which
     dissolved the corroboration of ADJACENT lines** — no-evidence rose from 4 to 9. So a
     per-line operation with per-line acceptance can degrade lines it never examined. That is a
     structural hazard, not a tuning problem.
- **CONSEQUENCE: item 2 is NOT wired, and `verifyLines.ts` carries this measurement in its header
  as a do-not-wire warning.** Kept rather than deleted because its specs document the invariants a
  replacement must hold, and because the numbers are the reason to be careful. Nothing calls it.
- **What would have happened had it shipped:** a real user's previously-correct opening line moved
  1.8s out, and 5 further lines silently lost their evidence. This is the eighth claim or build of
  mine that measurement has stopped, and by a distance the most damaging one to have wired.

### L21 — gap re-transcription reaches only HALF of what the verdict distrusts

- **Instrument:** `.cache/verdict-vs-holes.mjs` (scratch; the numbers are what matter and the
  computation is two committed primitives — `enumerateGapHoles` and
  `AlignmentTrust.repairableLineIndices`).
- **Status:** **SOURCED and reproducible** from committed fixtures.
- **Why it was measured.** Plan item 2 was to add verdict-driven line selection to the existing
  prompted windowed verification. Before building it, the question is whether the verdict reaches
  anything structural hole detection misses — if not, the selector change would add nothing.

  | config | holes | repairable | inside a hole | **outside** |
  |---|---|---|---|---|
  | guitar segment | 3 (8 lines) | 29 | 8 | **21** |
  | veil word | 6 (10 lines) | 15 | 10 | **5** |
  | stranger segment two-pass | 9 (25 lines) | 46 | 24 | **22** |
  | stranger word two-pass | 9 (25 lines) | 39 | 23 | **16** |
  | recollect segment two-pass | 6 (21 lines) | 41 | 20 | **21** |
  | **total** | | **170** | **85 (50%)** | **85 (50%)** |

  Exactly half of the lines the verdict distrusts are never re-transcribed by the gap pass,
  because they sit outside any structural hole.
- **Consequence:** item 2(a) — verdict-driven selection — is justified with a number rather than
  an assumption, and `src/ai-pipeline/verifyLines.ts` implements it (budget-bounded, worst-evidence
  first, `transcribeSlice` injected so it is testable without a model). It deliberately delegates
  acceptance to the SAME `spliceGapAlignment` gate the gap pass uses, since that gate is what
  rejected the prompt echo in L19; inventing a second, coverage-based rule here would make the echo
  self-fulfilling.

### L24 — the shipped gap pass is SAFE but effectively inert on real audio

- **Instrument:** real `whisper-small` driving `reanalyzeGaps` itself with a node-backed slice
  transcriber, scored against LRC truth. Developer-run.
- **Status:** sourceable, developer-run (real audio + real model, uncommitted).
- **Why it was measured.** L22 showed `spliceGapAlignment`'s LOCAL gate accepting globally harmful
  splices for single-line verification. `reanalyzeGaps` uses that same gate, and it runs on every
  fresh auto-align AND automatically once per song on open — so the question was whether an
  always-on shipped path was moving lines for the worse.
- **Measured on three songs:**

  | song | holes detected | holes attempted | Whisper calls | lines retimed | verdict |
  |---|---|---|---|---|---|
  | guitar-loneliness | 3 | **0** | 0 | 0 | no measurable effect |
  | veil | 6 | 1 | 1 | 0 | no measurable effect |
  | stranger-than-heaven | 9 | 3 | 3 | 0 | no measurable effect |

  Absolute metrics were **identical before and after** on all three (guitar 0.39/2.29, veil
  0.26/0.98, stranger 1.50/6.50), as were the within-250ms shares and worst lines. Veil's
  no-evidence count moved 12 -> 11 and nothing else did.
- **CONCLUSION — the concern is refuted.** Across three songs and four attempted holes the local
  gate accepted **zero** splices. The always-on gap pass is not moving lines for the worse; it is
  barely moving anything at all. Nothing needs changing.
- **BUT the second half is a finding in its own right: gap recovery does almost nothing on this
  corpus.** Four Whisper calls (3-12s each) produced **zero** retimed lines, which means the
  user-facing "Recover N sections" affordance and the automatic once-per-song gap recovery
  currently change nothing on real material. The prompt's value claim — recovering unaligned
  sections — is not realised here, and that is worth knowing before investing further in it.
- **A shape asymmetry worth noting, because it explains the L22/L23 results.** Hole-shaped windows
  (multi-line prompt over a bounded hole) are accepted by this gate essentially never, while
  single-line windows on already-placed lines produced accepts (harmful under a local gate, neutral
  under a whole-alignment one). The prompt shape drives the behaviour, so results from one shape do
  not transfer to the other — a caveat that applies to any future evaluation of either.

### L27 — the render layer is CORRECT at 1x playback; L26's "stuck highlight" was the check's fault, and the check found a real defect instead

- **Instrument:** `src/dev/e2eSyncHarness.tsx` rewritten to drive the app's OWN transport
  (`button[aria-label="Start playback"]`, `button[aria-label="Rewind 5 seconds"]`) instead of
  writing `setPosition`/`syncPosition` directly, plus `?untimed=1` for the no-timing state.
  Driven by Playwright headless Chromium (`/tmp/pwcheck/sync-check.mjs`, `--autoplay-policy=no-user-gesture-required`)
  against `npx vite --port 5199`. Reports to `/__e2e-status` → `node_modules/.e2e-status.log`.
  Reproduce: `node sync-check.mjs guitar 232` (wall-clock ≈ 4 min: 232 s of audio at 1x).
- **Status:** **SOURCED, reproducible, and now conclusive.**
- **Method.** Real playback at 1x. Every 200 ms: read the playhead, the store's `activeLine`, and
  the index of the row carrying the glow (`data-line-index`, added to the row for this check). The
  expected line comes from LRC truth with the app's own `VOCAL_ONSET_LEAD_S` imported (not copied),
  scored only ≥0.4 s inside a truth span so a boundary cannot be scored as a defect. A sample is
  discarded if the 100 ms engine tick lands mid-read.

| run | mode | scored | matched | store-vs-DOM | backward jumps | page errors |
|---|---|---|---|---|---|---|
| guitar full song | timed | 524 | **524 (100%)** | 0 | 0 | 0 |
| guitar, 30 s | untimed | 86 | 86 | 0 | — | 0 |

- **L26's run 3 is REFUTED as an app defect.** The "highlight stuck on line 15" appeared whenever
  the check poked the playhead BACKWARD (201.2 s → 91.4 s) with no playback running; every
  subsequent sample reported the stale line. Driving the app's real transport, a full song plus 12
  backward seeks through the app's own rewind control produce **0 backward-jump violations and 0
  DOM-vs-store disagreements**. The observation was an artifact of the *measurement*, exactly as
  L26's own conclusion suspected but could not establish. The residual "7/21" number should not be
  quoted as evidence about the app.
- **What the check DID find — a real defect, fixed.** In `?untimed=1` (every line `{startTime: 0,
  endTime: 0}`, which is what `songBuilder` leaves after a fresh lyrics import and `TapSyncEditor`
  stores for every line the user did not tap), playback highlighted the LAST line for the whole song:

  | | glow samples | rows seen | verdict |
  |---|---|---|---|
  | before fix | **86 / 86** | `[46]` | the last of 47 lines glowed from 0 s onward |
  | after fix | **0 / 86** | `[-1]` | nothing is claimed, which is what "untimed" means |

  Cause: `lineEffectiveEnd` gave a line with no timing a span from `startTime` (0) to the next
  line's start, and for the last such line `Infinity`. The same rule also made a partially
  tap-synced song highlight an untimed line for the length of each gap — visible in the timed run
  above as `storeActive = 46` from 187.25 s to the end of the song and `storeActive = 3` from 0 s to
  14.83 s. Fix: `lineHasTiming` moved to the `lineTiming` leaf and `lineEffectiveEnd` returns the
  line's own start when it has no timing, i.e. an empty span. `linesVisited` on the timed run fell
  9 → 7: the two phantom rows are gone, and the 524 scored samples are unchanged, so the fix is
  **regression-clean on timed lines**.
- **Bite test.** Four of the five new specs in `tests/lyrics/lineTiming.test.ts` FAIL with the fix
  removed and pass with it; the fifth (start present, end missing → next-start fallback) passes in
  both states by design, because it guards against over-fixing.
- **Serves:** item 7 (the mandatory browser sync check) — now a verdict rather than an open
  question, and C1–C4's *render-side* half. The offsets C1 measures remain untested by ear (L9).

### L26 — the sync check now RUNS in a real browser; its first results are not yet interpretable

- **Instrument:** `src/dev/e2eSyncHarness.tsx`, reachable at `/?e2e=<song>&sync=1`, driven by
  Playwright headless Chromium against a local vite server; reports through `/__e2e-status` and the
  sink file `node_modules/.e2e-status.log`.
- **Status:** **RUNS and is reproducible**; its verdict is **not yet established**.
- **What it does.** Seeds lyrics ALREADY TIMED from `/e2e/<song>-truth.json` (so no model, no
  transcription, no WebGPU — the check is about the RENDER layer), samples the playhead inside each
  line, and reads back the highlighted line's text as rendered. 21 samples on guitar-loneliness,
  **0 page errors**.
- **Three runs, three different results, and two of the three were MY measurement's fault:**

  | run | passed | failure mode | cause |
  |---|---|---|---|
  | 1 | 0/21 | `rendered` had interleaved furigana (`春はると秋あき`) | **check defect**: `textContent` includes `<rt>` readings, so containment failed on every line with ruby. Fixed by cloning and stripping `rt`. |
  | 2 | 10/21 | 11 samples found NO active element | **fixture defect**: lines were seeded `endTime = start + 2`, but sampling targets a fraction of the gap to the NEXT line, so on wide gaps the playhead sat outside the line I had created. The app correctly highlighted nothing. Fixed by ending each line at the next line's start. |
  | 3 | 7/21 | active line **stuck** on one line (15) for every later sample, 18 through 38 | **UNEXPLAINED** — and it varies between runs, which is the signature of a race in the sampling rather than a deterministic app behaviour |

- **CONCLUSION — deliberately withheld.** Run 3 cannot yet distinguish a real render-layer defect
  (the highlight stops following the playhead) from a sampling race (a pending React commit or an
  animated scroll landing after the read). The pass count moving 0 -> 10 -> 7 with *different*
  failure modes is itself evidence that the method is not yet deterministic. **Reporting "7/21
  therefore the app has a sync bug" would be exactly the unverified leap this ledger exists to
  prevent**, and so would reporting "the app is fine".
- **THE NEXT STEP, specified.** Stop poking the stores and observe the app's own behaviour instead:
  start real playback, let the engine drive `position`, and sample the rendered active line against
  `position` as it actually advances, asserting a monotonic mapping rather than instantaneous
  agreement at a poked position. That removes both the race and the poked-state assumption in one
  move, and it is what "the highlight lands with the vocal" actually means.
- **What IS established:** the check exists, runs in a real browser engine with clean page health,
  and needs no AI, no model and no WebGPU. Item 7's browser half has gone from "asserted impossible"
  (L25: wrong) to "built, running, verdict pending".

### L25 — a real browser IS available here, and the app boots clean in it **(corrects my own claim)**

- **Instrument:** Playwright 1.49.1 (`chromium_headless_shell`) installed to a temp dir with
  `--no-save`, driving a local `vite` server. No repo dependency added; browsers cached under
  `~/Library/Caches/ms-playwright`.
- **Status:** **SOURCED and reproducible** on this machine.
- **I had claimed for several rounds that item 7's browser check "cannot run here".** That was
  wrong, and it was wrong in the specific way this ledger exists to catch: I asserted an
  impossibility without testing it. What was true is narrower — the DSH *in-app* browser needs
  per-origin approval from an interactive user (which is what round 5 recorded). A locally
  launched headless Chromium needs no such approval.
- **Measured:** the app loads at `http://localhost:5199/` with **0 page errors and 0 console
  errors**, `#root` present, and:
  - `AudioContext` constructs and runs: `sampleRate=48000, state=running`
  - `indexedDB` usable
  Both are the player's foundations, so a real sync check in a real engine is not merely possible
  but cheap: no model, no transcription, no WebGPU is required to verify that the rendered active
  line tracks the playhead.
- **What remains for item 7 is therefore NOT "impossible" but "not yet built":** a sync-sampling
  dev harness that seeds lyrics timed from `/e2e/<song>-truth.json` (the app already serves those
  files for exactly this purpose, and `src/dev/e2eFlowHarness.tsx` shows the seeding pattern) and
  reports the rendered active line per sampled playhead position through the existing
  `/__e2e-status` sink, plus a Playwright assertion against it. Reconciled recipe:
  `npx vite --port 5199 --strictPort`, then Playwright from a temp install, driving
  `/?e2e=<song>&…`. Recorded so the next round starts from a working setup instead of a claim.

### L20 — the truth-free verdict cannot drive a SONG-level alert (item 3 refuted, half-redirected)

- **Instrument:** `scripts/align-trust-calibration.mjs` (the ALERT THRESHOLD section).
- **Status:** **SOURCED and reproducible** from committed fixtures.
- **Why it was measured.** Item 3 was "surface the calibrated verdict in the off-timing banner
  instead of the 54%-recall labels". Swapping a number that drives a user-facing alert is a
  behaviour change, so the threshold had to be measured rather than chosen — and swapping it
  blind had already flipped a spec once.
- **Measured, per config: the candidate signals beside absolute truth error.**

  | config | repairable | noEv | verified | absP90 | truth says |
  |---|---|---|---|---|---|
  | guitar word | 85% | 6% | 18% | 1.93 | quiet |
  | guitar segment | **100%** | 6% | 0% | 2.29 | alert |
  | veil word | 90% | 17% | 14% | 0.98 | quiet |
  | stranger word two-pass | 98% | 41% | 3% | 4.13 | alert |
  | stranger segment two-pass | **100%** | 41% | 0% | 6.50 | alert |
  | stranger segment-medium | **100%** | 27% | 0% | 8.36 | alert |
  | recollect word two-pass | **100%** | 75% | 0% | 13.50 | alert |
  | recollect segment two-pass | **100%** | 42% | 0% | 6.04 | alert |

  No candidate threshold separates: `repairableShare >= 0.30` alerts on everything (85-100%
  *including* the quiet songs), `noEvidenceShare >= 0.25` misses guitar segment (6% while
  genuinely 2.29s out), and `verifiedShare <= 0.35` flags nothing useful because veil sits at
  14% while being the best song in the corpus.
- **The reason is saturation, and it is a statement about the pipeline.** The verdict marks
  85-100% of lines repairable on EVERY song, because the pipeline leaves most lines without
  full corroboration everywhere. A song-level aggregate with no dynamic range has nothing to
  discriminate with — the same underlying fact as `converged` being 0/8 (L15).
- **CONCLUSION — half of item 3 is refuted, the other half redirected.** The verdict is fit for
  **per-line targeting within** a song (it separates cleanly there: verified p90 1.91s versus
  unverified 8.74s, L14) and **not** for a song-level alert. So:
  - the off-timing BANNER keeps its existing signals, which are already the discriminating ones
    (`accurateRealignReason`'s weak-labels share and segment-blocks) and which item 6 has just
    given a one-tap action;
  - the calibrated verdict belongs on the **drag strip**, ordering which lines to offer — that
    is where "which line is wrong" is the question being asked.
- **Not wired as an alert trigger.** No alert trigger was changed, on the evidence above.
  **The drag-strip half was implemented in round 15** (`selectAnchorTargets` gained an optional
  `verdictFlagged`, supplied from the stored transcript in `PlayerView`), because that is the
  layer where the verdict separates. It closes a recall gap that was invisible to the user: the
  drag strip's filter admitted only lines the LABELS already distrusted, and those labels catch
  22 of 41 known >1.5s errors — so a line confidently called `good` while sitting seconds from
  the vocal could never be offered for re-timing at all.

### L17 — the envelope-based offset screen does not work on real singing

- **Instrument:** `scripts/offset-estimate-real.mjs` (planted offsets against real audio) and
  the curve diagnostic that followed it.
- **Status:** **SOURCEABLE, not reproducible from the repository** — real audio, uncommitted.
  Recorded so nobody rebuilds this.
- **Measured, planted offsets on real sung audio:** **20 of 20 recoverable cases REFUSED, 0
  recovered.** No wrong answers and no false alarms on the 5 already-correct cases — safe, and
  useless.
- **WHY, and it is the statistic rather than my gates.** At the TRUE alignment, the score curve
  should peak at shift 0. Measured:

  | statistic at true alignment | peak | value at 0 | ratio |
  |---|---|---|---|
  | guitar mix, onset w=0.5 | **0.00 s** ✓ | 0.0229 | 1.00 |
  | guitar mix, onset w=0.25 | 0.06 s | 0.0278 | 0.74 |
  | veil mix, activity w=0.25 | **1.04 s** ✗ | 0.0221 | 0.48 |
  | veil mix, onset w=0.15 | **0.92 s** ✗ | −0.0016 | −0.06 |

  The premise — "a line start is where vocal energy rises" — holds on guitar-loneliness and
  fails on veil, and the score magnitudes on real singing are 0.02–0.17 against 0.65–0.87 on the
  synthetic Tier A carriers. So Tier A validated the *plumbing* (envelope, windows, search,
  refusal logic) and could not have validated the *statistic*; that is exactly what Tier A's
  header says it cannot do, and the first real-audio test confirmed it.
- **REFUTATION.** I proposed this as "the single best lever" and the item that would reach the
  C1 target of a <=100ms systematic offset, and I argued it was uniquely valuable because it
  needs no Whisper and therefore works on the Manual tier. On real singing it does not work at
  all. It is **not wired**, and it must not be: a no-op would be harmless (`shouldEscalate`
  style refusal) but pointless, and any loosening of its gates to make it fire would move
  correct timings on the strength of a statistic that peaks a second away from the truth.
- **THE FRAMING THIS LEAVES.** The app already HAS a working offset estimator: `fitPriorTimeMap`
  (lyrics/lrcPrior.ts), which fits an affine map against **matched transcript evidence** and is
  the engine behind the 8/8 prior-reconciliation result (L12). My envelope version was an
  attempt to get the same answer without paying for a transcription. That attempt failed. So
  correcting already-timed lyrics is deliverable **only** via the evidence-based path, and its
  cost is one transcription — which reframes plan item 1 and promotes prior-guided windowed
  verification (item 2) to the primary lever, since that path can both DETECT an offset and fix
  it at a fraction of a full transcription.

### L16 — whisper-medium is NOT uniformly better, and L13 was too narrow

- **Instrument:** `scripts/align-ablation.mjs --axis=model`.
- **Status:** **SOURCED and reproducible** (committed fixtures).
- **Measured, stranger-than-heaven on the app's two-pass path:**

  | config | absP50 | absP90 | worst | evP90 | no-evidence |
  |---|---|---|---|---|---|
  | **small + word** (shipped default) | 1.46 | **4.13** | 9.16 | 3.30 | 30 |
  | medium + word | 1.58 | **12.35** | 14.82 | **12.45** | 26 |
  | small + segment | 1.50 | 6.50 | 12.35 | 3.30 | 27 |
  | medium + segment | 1.34 | 8.36 | 12.35 | 3.30 | 21 |

- **REFUTATION of L13.** L13 concluded from `segment ja-only` that "whisper-medium's benefit is
  anchoring, not timestamp precision" (no-evidence 33 -> 26, evP90 4.46 -> 1.79). That is true
  for a **ja-only segment** run and it is not true of the path the app actually takes. On the
  two-pass path medium leaves evP90 unchanged (3.30) while making absP90 *worse* (6.50 -> 8.36),
  and with **word** timestamps it is dramatically worse (absP90 4.13 -> **12.35**, evP90
  3.30 -> **12.45**). The narrow true statement is: medium improves coverage on a ja-only
  segment run. The general claim was wrong.
- **CONSEQUENCE — the promotion I proposed is refuted before it was built.** I offered
  promoting medium as the biggest user-visible lever, on the strength of L13. Measured, it
  would make the hardest song notably worse on the shipped word-mode default. So it was NOT
  wired. This is the third claim of my own that measurement overturned, which is the ledger
  working as intended rather than a defence of it.
- **A LIMITATION OF THE VERDICT, found by this measurement.** The truth-free comparator ranks
  no-evidence above the error tail, so on the segment pair it picks **medium** (lower
  no-evidence share) while truth picks **small** (better absP90) — it agrees on word, disagrees
  on segment. That ordering is *correct* for what the correction loop uses it for: a repair
  round that loses coverage IS a regression. It is **not** fit for choosing between two
  transcripts or two models, where a coverage gain can come with a much worse tail. Recorded so
  nobody reuses the verdict for model selection on the strength of the 3/3 mode result.

### L12 — reconciling against an already-timed prior beats aligning from scratch (8/8)

- **Instrument:** `scripts/align-ablation.mjs --axis=prior`; gated in
  `tests/ai-pipeline/lrc-truth.test.ts` ("a correctly-shaped prior never loses to aligning
  from scratch", 6 assertions over 3 pairs × 2 prior error sizes).
- **Status:** **SOURCED and reproducible.**
- **Measured** across 8 song-mode pairs, with the prior perturbed by a constant offset:

  | prior error | mean absP90 | better | tie | worse |
  |---|---|---|---|---|
  | +0.0 s (already exact) | 1.52 | 8 | 0 | 0 |
  | +0.3 s | 1.44 | 8 | 0 | 0 |
  | +0.7 s | 1.44 | 8 | 0 | 0 |
  | +1.4 s | 1.44 | 8 | 0 | 0 |
  | +2.5 s | 1.89 | 8 | 0 | 0 |

  Scratch mean absP90 across the same pairs: **5.47**. Individual examples: recollect
  segment two-pass p50 1.77 → **0.07** and within-250 ms 21% → **83%**; stranger word
  two-pass absP90 4.13 → **1.79**. Nothing got worse, at any error size. The jump at
  +2.5 s is `fitPriorTimeMap`'s own 2.5 s inlier tolerance, i.e. a tunable, not a cliff.
- **What it settles:** the policy at `src/player/alignmentPolicy.ts:42` — refuse to align
  lyrics that already carry timings — is not merely unsourced (L1/L2), it is **actively
  costly**. Reconciling against a prior is the single largest measured win in this ledger.
- **THE CAVEAT THAT KEEPS THIS HONEST:** the prior constructed here has **truth's relative
  structure** and only a constant offset. That is what a duration-matched catalogue entry
  *should* be; it is not proven to be. This entry says "reconciliation cannot lose to
  scratch when the prior's shape is right". It does **not** say real LRCLIB entries have
  the right shape, and must not be cited for that. Settling it needs a handful of real
  songs with a duration-matched catalogue entry — which does **not** require the user's
  singing.
- **Why it is not auto-applied yet:** running alignment costs a full transcription
  (minutes), and auto-applying a *shift* from `offsetEstimate` would mutate a user's
  timings on evidence from synthesized carriers only (L10). Both are gated on real-audio
  validation. Note the machinery already exists and is wired: `applyLrcPrior` runs inside
  AutoAlignFlow for any song with outside timing, so the prior-aware path is reachable
  today — the gap is discoverability, not capability.

### L13 — whisper-medium's benefit is ANCHORING, not finer timestamps

- **Instrument:** `scripts/align-ablation.mjs --axis=mode`.
- **Status:** **SOURCED and reproducible.**
- **Measured** on stranger-than-heaven, same lyrics, ja-only:

  | mode | absP50 | absP90 | no-evidence lines | evP90 |
  |---|---|---|---|---|
  | segment (small) | 2.15 | 32.39 | **33** | 4.46 |
  | segment-medium | **1.20** | **8.14** | **26** | **1.79** |

  Medium removes 7 lines' worth of evidence absence and cuts the evidence-backed p90 by
  60%. The dominant error term in this corpus is *lines the transcript never reaches at
  all* (34 of 59 on the worst config), not the precision of the lines it does reach — and
  the bigger model's real contribution is reaching more of them.
- **Serves:** the deferred D9 (escalation cost) and W1.5. It reframes the "high accuracy"
  option from a timestamp-fineness upgrade to a **coverage** upgrade, which is what a
  cost/benefit decision needs to know.

### L9 — perceptual contract C1–C4 (plan §3)

- **Instrument:** none yet. Proposed from L4 (the tightest product-side figure) and karaoke
  usability practice.
- **Status:** **UNRATIFIED.** Deliberately not presented as measured.
- **Serves:** plan decision item 1. Until ratified by ear on real songs, C1–C4 are a
  proposed requirement, and the ratchets in L7 are what CI can actually enforce.

---

## Refutation log

| date | entry | what happened |
|---|---|---|
| 2026-09-28 | L3 | The plan's first draft asserted the shipped word mode was catastrophic on the committed evidence. Measurement refuted it: on the mix fixtures word two-pass is the *best* of three (absP90 4.13 vs 6.50 vs 8.36). The stem measurement still stands. Corrected in the plan's §0 and recorded here. |
| 2026-09-28 | offset screen | I called the envelope-based offset screen "the single best lever" and the one thing that would reach C1, explicitly because it needs no Whisper. Measured on real singing: 20/20 refusals, 0 recoveries, because the underlying statistic peaks ~1s from the truth on one of two songs. Not wired. The working equivalent already existed and costs a transcription (L12/L17). |
| 2026-09-28 | L13 / promotion | I proposed promoting whisper-medium as the biggest user-visible lever, on the strength of L13's coverage finding. Measured first, as the plan requires: medium is *worse* on the shipped word-mode default (absP90 4.13 -> 12.35) and the truth-free verdict picks the wrong model on one of two pairs. Promotion not wired; L13 corrected to its narrow true form (L16). |
| 2026-09-28 | L12 | The plan's D3 assumed the replacement for `alignmentPolicy.ts:42` was a cheap *screen* (L10). Measurement showed the bigger prize is prior *reconciliation* (L12): 8/8 pairs improved, mean absP90 5.47 → 1.44. The screen is still what makes auto-application safe, but the ordering of W1.2's layers changed — Layer 3 is the highest-value part, and its machinery was already wired and unreachable. |
| 2026-09-28 | L11 | The plan's Phase-2 centrepiece (W1.1.1, transcript ramp repair) was designed around the "+24 s decaying to +2 s" ramp. Measuring it for the first time against committed fixtures found no meaningful drift anywhere. W1.1.1 is therefore blocked on real audio rather than queued, and the drift instrument became a deliverable instead of the repair. |
| 2026-09-28 | L10 | The first `MAX_SHIFT_SEC` (3.5 s) produced a confidently wrong answer on a masked carrier and could not distinguish a true −0.48 s shift from a spurious −1.84 s one. Both were measured, and the range plus the magnitude gate were set from those numbers. |
| 2026-09-28 | `bnd_measured` | Emitted as a *string* so it was exempt from the numeric guards, which let a corpus row be committed with **0** measurable boundary lines and eight vacuous `0 ≤ 0` assertions. Made numeric with a higher-is-better guard in `scripts/audit-corpus.mjs`, a coverage floor in `tests/ai-pipeline/corpus-scorecard.test.ts`, and an explicit `ZERO_COVERAGE_BY_DESIGN` set naming the one row allowed to score nothing. Both guards were verified to FAIL when coverage collapses (baseline raised above actual) and to pass when restored. |
| 2026-09-30 | L26 run 3 | "The highlight sticks on line 15 and 18 of 21 samples fail" was reported as an unexplained possible render-layer defect, with the honest caveat that a sampling race would look identical. Both halves resolved by L27: it was the check's own out-of-order store pokes, and real playback over a full song shows 524/524 correct with zero DOM-vs-store disagreements. The old pass counts (0/21, 10/21, 7/21) are measurement artifacts and are not evidence about the app. |
| 2026-09-30 | untimed highlight | Found BY the browser check rather than by reasoning: a song with no timing highlighted the last lyric line for its entire length (86/86 samples), because `lineEffectiveEnd` invented a `[0, ∞)` span for a line that has none. Fixed in `lineTiming.ts`, verified 86/86 → 0/86 in the browser, 4 new specs fail without the fix. |
