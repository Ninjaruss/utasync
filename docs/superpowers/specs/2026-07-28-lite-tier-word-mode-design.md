# Lite-Tier Word-Level Timestamps — Design

**Date:** 2026-07-28
**Goal:** Extend the full-tier word-mode default (PR #37) to **lite tier**, so
lite devices also get tighter line starts/tails instead of the tail-clipping
segment mode — *if and only if* a real lite-device speed measurement shows it is
acceptable. Unlike PR #37, this is **measurement-gated**, not a blind flip.

**Why lite is the same argument as full — with a speed caveat:**
- Lite tier is **WebGPU + 4–5GB** (`capability.ts:24`), so its transcription runs
  the **manual per-window word path** (`whisper.worker.ts`, `requestedDevice ===
  'webgpu'`) — the very path that sidesteps the WASM long-form merge stall the
  `lite → segment` rule was guarding against. The stall reason does not apply to
  lite's actual code path.
- Word mode matters **more** for lite: vocal separation is full-tier-only
  (`canUseVocalSeparation` → `tier === 'full'`), so lite has **no stem envelope**
  and therefore **no acoustic tail-refinement available** — word mode is lite's
  *only* fix for the ~0.7–1.0s clipped tails (`segment-mode-tail-clipping`).
- **The caveat:** lite = weaker GPUs. Per-window word decode may be too slow (or
  OOM) on the weakest lite devices. This is the one real difference from full
  tier, and it is why the flip is gated on a measured wall-clock, not assumed.

## Decisions (user-confirmed)
- Pursue defaulting **lite → word**, gated on a live lite-device measurement.
- Full / manual / high-accuracy (whisper-medium forces segment) tiers unchanged.

## The gate (Task 0, user-run — I cannot measure a weak GPU here)
On a **real lite device** (WebGPU, ~4–5GB, ideally a low-end target) align a
~4–5min song in word mode and record: (a) it completes without crash/OOM, (b)
wall-clock vs the current segment default. Decision:

- **(A) Acceptable everywhere** (completes cleanly, time within a tolerable
  budget — suggest ≤ ~2× segment and no UI freeze): flip lite → word
  unconditionally and **retire the now-vestigial opt-in**.
- **(B) Works but slow on the weakest devices:** flip lite → word by default but
  add a **"Faster timing (less precise)" segment opt-OUT for lite** (the inverse
  of today's opt-in) so slow-device users can escape the multi-minute pass.
- **(C) Unacceptable** (crash / OOM / absurd time): **do not flip.** Keep lite on
  segment, record the negative result, close this lever.

The plan implements (A); (B) is a documented conditional add-on; (C) is the abort.

## Code changes (branch A)

### 1. `preferredWhisperTimestampMode` (`alignTimestampMode.ts`)
Remove `if (tier === 'lite') return 'segment'`. All non-manual tiers now resolve
to `'word'` (manual never transcribes). The body collapses to `return 'word'`
after the accurate-readings override (which becomes redundant — see below). Keep
the signature stable for callers (`AutoAlignFlow.tsx:278`, `e2eAlignHarness.ts`).

### 2. Retire the vestigial "Accurate timing (slower)" opt-in
With full **and** lite defaulting to word, the opt-in that merely *forces* word
benefits no tier. Remove it end-to-end:
- `alignTimestampMode.ts`: `accurateReadingsAvailable` → always `false`;
  `accurateReadingsEstimate` → always `null`. (Or delete both + callers — decide
  in the plan by grep; keep the module's `TimestampModeOptions` only if still
  used.)
- `AutoAlignFlow.tsx`: delete the "Accurate timing (slower)" checkbox
  (`~757`), the `accurateReadings` state/prop, and pass-through.
- `PlayerView.tsx`: drop `alignAccurateReadings` state and the `accurateReadings`
  argument threaded through `beginAlignment` / `AutoAlignFlow`.
- **Keep** `suggestsWordLevelAlignment` / `accurateRealignReason` and the
  Play/Edit "approximate timing" notes — they still fire for **whisper-medium
  high-accuracy** songs (which force segment) and the Play banner deliberately
  advises tap-to-fix rather than re-align. Just confirm they read correctly with
  no default-path segment songs.

### 3. (Branch B only) "Faster timing" lite opt-out
If Task 0 lands on (B): add a `fastSegment?: boolean` option to
`preferredWhisperTimestampMode` (`tier === 'lite' && fastSegment → 'segment'`),
surface a "Faster timing (less precise)" checkbox on lite in AutoAlignFlow, and
thread it the same way the old opt-in was. This inverts the retired control:
default word, opt out to segment for speed.

## Honesty / measurement
- Accuracy upside is the same class PR #37 measured (word ≥ segment on median/
  tail). `scripts/word-vs-segment-scorecard.mjs` already covers it at the aligner
  level (tier-independent, since it scores transcripts not devices).
- The **only new risk is device speed**, which is exactly what Task 0 measures and
  is unmeasurable in node — so the gate is a live run, and (B)/(C) exist so a slow
  result does not force a bad default onto weak devices.

## Out of scope
- Full/manual/high-accuracy behavior; the aligner itself.
- The wrong-occurrence p90 outliers (separate lever).
- stable-ts `refine()` (infeasible in transformers.js — no per-token log-probs;
  gated spike only, see `word-timestamp-lever` memory).
