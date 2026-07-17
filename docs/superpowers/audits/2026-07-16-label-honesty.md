# Round 11 — per-line label honesty ("says aligned but isn't")

**Date:** 2026-07-16
**Complaint:** some lines read as aligned (no chip / 'good') while the highlight
is on the wrong part of the song or doesn't cover the line's full sung timing;
the app should also say clearly when a song needs a more powerful pass.

## Instrument

`scripts/audit-line-quality.mjs` — new per-line label-honesty audit. For every
corpus config it runs the real pipeline and cross-tabulates each line's quality
label against (a) ground truth starts — human-synced LRC for guitar-loneliness
and stranger-than-heaven, official caption onsets for akfg — and (b) the line's
own attributed transcript span. `--details` prints every defective line,
`--dump <dir>` writes per-line JSON.

**Pre-fix measurement:** 41 lines labeled `good` start >1.5s (per-line tol) from
truth across the 14 truth-bearing configs; worst offenders 38s off (repeated
chorus tag on a stolen occurrence). 115 `approximate` lines were also grossly
misplaced, but that label at least does not claim verified timing.

## Root causes (each confirmed by prototype measurement)

1. **Window-relative scoring is position-blind.** `scoreLineAlignment` checks
   for matching audio within −6/+8s (`LINE_VALIDATE_WINDOW_*`), so a line up to
   ~7s off, or on a *different sung occurrence of the same phrase*, still scores
   'good'. A strict ±0.75s re-score was prototyped and REFUTED (catches 6/59):
   misplaced lines usually sit on locally-matching audio.
2. **Transcript holes cascade into stolen anchors.** stranger-than-heaven
   (ja-forced): Whisper transcribed nothing for 165→200s; lyric lines #40–51
   were packed into the preceding 20s, and #51 "Stranger than heaven" anchored
   'good' (cov 0.83) on the sung occurrence that belongs to #38. The
   needs_review→approximate upgrade passes then disguised the hole run from
   `enumerateGapHoles` (which keys on needs_review), so gap re-transcription
   could not see it.
3. **Shared segment chunks.** A >2.5s segment "word" covering ≥2 lines means the
   boundaries between them are interpolated — per-line ends there are estimates
   no matter what the window score says (the known >180s tail-clipping mode).
4. **Segment/word transcript skew (~1.5–3s)** where the line's own evidence
   agrees with the placement but the evidence itself is late. **Provably
   undetectable from text**; only a stronger pass (word-level / whisper-medium)
   or audio-energy onset checking can fix it.
5. **Proportional mode** still emitted 'good' labels (autolang configs: 5 labels
   with 12–94s errors) from cross-script char-bigram coincidences.

## Fix — `src/lyrics/labelHonesty.ts` (label-only, strictly downward)

`applyLabelHonesty` runs at the end of `refineAlignmentWithPhrases` (after the
tail cap; skipped on the mixed inner passes via
`AlignLyricsOptions.skipLabelHonesty` and applied once to the merged result in
`refineMixedLanguageAlignment` against the merged transcript). Gates:

- **G1 proportional cap** — no 'good' in proportional mode (5 catches / 0 collateral).
- **G2a shared-chunk members** — every line of a ≥2-line group sharing a >2.5s
  chunk demotes to approximate (51 flags; 16 truth-misplaced catches; the rest
  are honest end-approximation).
- **G2b clipped tail** — attributed span extends >0.75s past the line end and
  does not reach into the next line's evidence (+0.3s guard; guard validated
  against caption end-truth, akfg #4 vs #24).
- **G4 contested occurrence (occurrence-deficit ∧ desert)** — repeated sheet
  text with fewer strong attributed spans than sheet occurrences (or span order
  inversion): non-endpoint 'good' claims flanked by ≥2 desert lines
  (needs_review / evidence-free / compressed approximates) demote. Catches the
  38s stolen anchors with 1 near-miss flag.

Never touches needs_review (gap-hole detection and gap-realign acceptance
counters unaffected — verified: corpus baseline shows zero needs_review drift)
and never changes timing (audit-vs-lrc output byte-identical).

**Post-fix:** truth-misplaced 'good' lines 41 → 19 (residual is the class-4
skews plus 2–5 line mixed-path leftovers); segment/autolang configs at 0.
`good` counts in word-mode configs unchanged (veil 34, akfg-word 24,
my-eyes-only 37, guitar-word 40) — precision kept where labels were honest.

## "Needs a more powerful pass" indicator

`accurateRealignReason(lines, transcriptWords, quality, tier)` in
`alignTimestampMode.ts`:
- `'segment-blocks'` — existing merged-chunk signal (unchanged trigger, now the
  first tier of the reason);
- `'weak-labels'` — ≥6 and ≥35% of scoreable lines not 'good' after the honesty
  pass. Edit-mode hint says N lines couldn't be verified and recommends
  word-level timestamps or the High-accuracy (whisper-medium) model; CTA opens
  the align flow (`beginAlignment('auto', true)`) where both toggles live.
  Hint priority: lyrics-mismatch > block-timing > weak-labels > off-timing.

Corpus check of the weak-labels trigger: fires for stranger-than-heaven (all
modes; medium demonstrably fixes its class-4 lines: word-medium re-times
mixed-word's #21–23 to ~0s error) and guitar-segment; stays quiet for veil
(29% — off-timing banner owns its 7 rows), akfg-word (20%), my-eyes-only (8%).

## Shipping

- `ALIGNMENT_PIPELINE_VERSION` 21 → 22 — stored songs re-refine from their
  stored transcript on open and pick up honest labels.
- CI ratchet: `tests/ai-pipeline/labelHonesty.corpus.test.ts` pins per-config
  truth-misplaced-good ceilings AND 'good'-count floors (anti-over-flagging).
  Unit gates: `tests/lyrics/labelHonesty.test.ts`; indicator:
  `tests/ai-pipeline/alignTimestampMode.test.ts`,
  `tests/lyrics/EditMode.alignmentHint.test.tsx`.

## Part 2 (same day) — focused re-pass on suspect sections

The "upgrade-pass hole disguising" deferred item above shipped immediately as
the second half of round 11:

- **`enumerateGapHoles(refined, words)`** now enumerates maximal runs of
  UNVERIFIED lines (needs_review OR approximate) bounded by verified 'good'
  anchors, kept when the run contains real trouble (needs_review or an
  evidence-desert approximate via the shared `isEvidenceDesertLine` from
  labelHonesty). Disguised holes surface; a wrongly-anchored approximate line
  no longer caps the window.
- **`holeWorthRetrying`** also fires when the window contains an
  un-transcribed audio span ≥ `UNTRANSCRIBED_SPAN_MIN_S` (8s) — a wide run
  whose edges partially corroborate can hide a never-transcribed chorus that
  keeps run-coverage above the 0.15 floor.
- **`chooseSliceWindow`** (gapReanalyze) aims the ≤30s slice at the largest
  un-transcribed span when it starts past the hole front; prompt biasing for
  aimed slices uses the UN-corroborated hole lines instead of the placement
  prefix (placements are known-wrong over a void).
- **Focused splice range**: the slice's fresh words are attributed across the
  hole texts (timing-independent LCS); the splice covers only
  [first,last] lines with strong coverage (≥ `PROBE_STRONG_COVERAGE` 0.55).
  Measured necessity: endpoints on weaker echo matches dragged
  correctly-placed lines (stranger #52/#53) 5–9s off; with the floor they stay
  byte-identical.
- **Acceptance** (`spliceGapAlignment`): fresh-anchor splices into
  all-approximate runs can be accepted when needs_review is not worse AND
  placement-aware coverage (candidate vs its merged transcript) beats the
  before-coverage by ≥ 0.1; realize-check unchanged (still the prompt-echo
  backstop). The transcript splice drops only the RE-HEARD slice window's old
  words (`sliceT0/sliceT1`), not the whole hole window.
- **`GAP_RECOVERY_VERSION` 1 → 2** — stored songs get one more automatic
  focused pass on open.

Measured on the pathological stranger-than-heaven ja-forced fixture with the
committed EN-forced transcript as the mock slice
(tests/ai-pipeline/gapReanalyze.stranger.e2e.test.ts): last-chorus lines
#45–51 recover from −36…−38s error to −4.5…0.0s; correctly-placed #52–54
byte-identical; block mean |err| (lines 40–54) 28.5s → 11.8s. The remaining
error is the ♪-only adlib bridge (#40–44) whose audio Whisper cannot hear in
any language — honestly left flagged.

## Deferred / known limits

- **Class-4 skews (~1.5–3s, evidence-agreeing)** stay labeled 'good' per line —
  text evidence cannot see them by construction. Owned at song level by the
  weak-labels/segment-blocks hint. An audio-energy onset check at line starts is
  the only per-line detector candidate (round-12 candidate; VAD infra exists in
  the vocal-separation path).
- Adlib/vocalization runs over instrumental-adjacent audio (stranger #40–44)
  are unrecoverable by re-transcription; they stay approximate/needs_review and
  ride the off-timing banner.
- An instrumental break ≥ 8s inside a hole window now costs one wasted slice
  (worth-retrying fires, accept-if-better rejects) — bounded by
  MAX_HOLES_PER_PASS and the retried-once set.
- G4's near-miss flag (seg-medium #38, start-correct but span extends 8s past
  the end) is an end-defect demotion in spirit; kept.

## Part 3 (same day) — live end-to-end verification on real audio

Ran the full pipeline fresh on the real STRANGER THAN HEAVEN mp3
(~/Downloads, 233.5s) against the human-synced LRC truth, via two new
repeatable instruments:

- `scripts/e2e-align.mjs <mp3> <lyrics> <truth> [--mode] [--model] [--no-gap]`
  — Node runner mirroring AutoAlignFlow (decode → forced-language passes →
  mixed merge → focused gap re-pass → truth scorecard).
- `src/dev/e2eAlignHarness.ts` + `/?e2e=stranger` (dev-only, main.tsx-gated) —
  the same flow self-driving IN A REAL BROWSER, rendering a scorecard,
  POSTing progress to the dev server's `/__e2e-status` sink (vite.config),
  downloading a JSON report. Assets staged under public/e2e/ (gitignored —
  audio is copyrighted).

Results (start-error vs LRC, median version offset removed):

| config | mean | p50 | >1s | notes |
|---|---|---|---|---|
| Node, DEFAULT (segment+small, mixed 2-pass, gap re-pass) | 1.63s | 0.53s | 19/59 | best; last chorus ±0.5s |
| Firefox 152 (WebGPU, tier=full), same default path | 1.81s | 0.45s | 20/59 | 5.5 min total; parity ✓ |
| Node, word-mode opt-in + gap re-pass | 3.98s | 0.74s | 27/59 | fresh word-JA garbles #31–39 (+12–26s); labels honest (approx/review) |
| Node, word-mode, gap re-pass DISABLED | 5.42s | 1.90s | 33/59 | proves the focused re-pass improves, never caused, the block shift |
| Node, High-accuracy (medium q8) | 13.41s | 9.88s | 42/59 | q8 medium garbles this song's first half in the node stack; labels honest (12 good) |

Key findings:
- The app-default path delivers "mostly very little off sync": ~2/3 of lines
  within 1s, median ~0.5s; residual >1s lines are the intro block (−8…−14s,
  Whisper hears the first sung lines late), the un-transcribable ♪ adlib
  bridge (#39–43), and 1–3s skews — 14 of Firefox's 20 off-lines carry honest
  approximate/needs_review labels.
- Firefox parity confirmed live: navigator.gpu present → tier 'full' (the
  round-4 estimateDeviceMemory fix), WebGPU inference, same quality as node.
- CAVEAT for the weak-labels hint: on THIS song the recommended stronger
  passes measure WORSE than the default (word-JA garbles a repeated block;
  q8 medium garbles the first half). The labels/off-timing UI stay honest in
  every configuration, but "Re-align accurately" can regress a song since a
  full re-align has NO accept-if-better. Round-12 candidates: keep-if-better
  on full re-align (compare honest label counts before/after and offer
  revert), and intro-block recovery (first sung lines swallowed by a long
  early line — the one recurring 'good' false negative left, #2 at −13.6s).

### AKFG Rock'n'Roll Morning Light Falls on You (THE FIRST TAKE) — live run

Same instruments, second real recording (~/Downloads, 393s video rip: ~98s of
talking before the song; truth = official caption onsets, public/e2e/
akfg-truth.json, generated from akfg-ground-truth.test.ts; harness generalized
to /?e2e=<song>). Default path, both legs:

| leg | mean | p50 | p90 | >1s | >1.5s | labels |
|---|---|---|---|---|---|---|
| Node | 0.44s | 0.32s | 1.32s | 3/24 | 1 | 23 good / 6 approx / 1 review |
| Firefox 152 (WebGPU) | 0.41s | 0.36s | 0.96s | 2/24 | 0 | same |

Every measured line is within the caption truth's own ±2s tolerance except one
(−2.08s in the Node leg, honestly labeled approximate). The 98s talking intro
anchored nothing (line #0 lands ±0.35s); the focused gap re-pass correctly
found zero sections to recover; non-good share 23% keeps the weak-labels hint
quiet — the indicator stays silent exactly when the song is genuinely tight.

### Remaining songs — live runs (default path, node + Firefox 152/WebGPU)

| song | leg | mean | p50 | >1s | honesty notes |
|---|---|---|---|---|---|
| guitar-loneliness (LRC) | node | 0.91s | 0.60s | 11/36 | 5/7 worst flagged; 2 'good' ~1.7s skews (class-B) |
| guitar-loneliness | Firefox | 1.58s | 1.02s | 18/36 | FF transcription heard the intro late (+7–9s, flagged approx/review); gap pass found nothing new |
| veil (LRCLIB 5395357) | node | 0.39s | 0.25s | 4/48 | ZERO false negatives — all 4 off-lines flagged |
| veil | Firefox | 0.75s | 0.18s | 7/48 | intro block #1–3 −3.7…−9.4s labeled 'good' (the intro FN class, backend variance) |

my-eyes-only: mp3 no longer on disk — fixture-based corpus coverage only.

Cross-run conclusions (8 live runs, 4 songs, 2 engines):
- Song bodies align tightly everywhere (medians 0.18–1.02s); intros over
  instrumental/vocal-ambiguous openings are the ONE recurring weak region, and
  the only place 'good' still lies (stranger #0–2, veil-FF #1–3) — round-12
  candidate: first-lines onset verification against vocal activity.
- Whisper backend variance (node CPU q8 vs Firefox WebGPU fp16) shifts which
  lines mis-transcribe run to run; the aligner + labels behave identically.
- The focused gap re-pass fired only where needed (stranger 1–2, guitar 1,
  veil 1, akfg 0) and never regressed a run.
