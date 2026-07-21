# Anchor-based auto-fit — design

**Date:** 2026-07-21
**Status:** Approved (design); Phase 1 scoped for implementation
**Branch:** `feat/anchor-based-auto-fit`

## Goal

Shrink the manual-editing surface of lyric alignment to (at most) a single tap.
Most timing problems should correct themselves; the one thing a user might still
do is place a precise anchor by ear — and even the song's start/end anchors are
auto-detected when the signal is strong enough.

This realizes the product direction: *"reduce any need for the user to manually
edit things; most things that need adjustment should auto-adjust,"* under the
chosen policy **"auto-fix the clear wins silently, and for the genuinely
uncertain parts, replace per-line editing with one tap."**

## Non-goals (Phase 1)

- Continuous, playback-time drift correction (rejected: reintroduces the
  confident-but-wrong risk we removed in the mixed-merge forward-collapse fix,
  PR #27).
- Raw-audio vocal-activity detection for start/end. Not on `main` (the round-13
  acoustic envelope lives on a separate branch). Phase 1 uses the
  transcript-derived onset; audio-VAD precision is a Phase 2 upgrade.
- Removing existing controls/UX (Auto-align, Re-align, Recover) — this layers
  on; a later pass can prune whatever the anchors make redundant.

## The model

Every stored alignment may carry a small set of **timing anchors** — `(lineIndex
→ exact time)` pins the line timing must honor. Between anchors, line start times
are re-fit automatically (monotonic, weighted by singing length). Anchors have a
trust order:

1. **user** — a playback tap; exact; always wins.
2. **auto-start / auto-end** — first/last strongly-matched line's onset; applied
   only when its coverage clears a gate.
3. The aligner's existing confident `lcs` matches remain the within-region
   evidence; anchors sit *on top* as hard constraints.

The user's only possible manual act is one tap on a flagged line. Everything else
adjusts itself, and anchors are **sticky** — a later re-align re-fits *around*
them instead of discarding them (today, editing/re-align wipes manual work).

## Components

### 1. Anchor data model
Additive, backward-compatible field on the stored alignment (`LyricsData` in
`src/core/types/index.ts`):

```ts
timingAnchors?: { lineIndex: number; time: number; source: 'user' | 'auto-start' | 'auto-end' }[]
```

Absent ⇒ current behavior, byte-identical. No migration required.

### 2. `refitAroundAnchors` (pure)
`refitAroundAnchors(lines, anchors): TimedLine[]`
- Pins each anchored line's `startTime` to its anchor `time`.
- Re-interpolates each run of lines *between* consecutive anchors by `lineWeight`
  (reuse `src/ai-pipeline/aligner.ts` `lineWeight`), so a long line gets
  proportionally more of the span.
- Enforces monotonicity + display floor (`enforceLineMonotonicity`,
  `enforceLineDisplayFloor` in `phraseAlignment.ts`).
- Lines before the first anchor / after the last: shift by the nearest anchor's
  delta (translate, don't rescale) so unanchored tails aren't distorted.
- Pure and deterministic → unit-testable with synthetic inputs.

### 3. Auto start/end detector
From `computeLineMatchedSpans(lineTexts, transcriptWords)`
(`src/ai-pipeline/contentAligner.ts`): the first line whose coverage ≥ a gate
contributes its `firstTime` as an `auto-start` anchor; the last such line
contributes `lastEndTime` as `auto-end`. If no line clears the gate near the
edges, emit **no anchor** (never a wrong one) — the tap prompt covers it.

### 4. Tap-to-anchor UI
Each flagged region (a run of `needs_review` lines) shows one affordance during
Play-mode playback: *"Tap when this line starts."* One tap → capture playhead →
append a `user` anchor for that line → `refitAroundAnchors` re-times the
surrounding run live → persist. This replaces the per-line clock/scrub
(`TimestampPopover`) for those lines. Reuses the tap-capture affordance style of
`TapSyncEditor`, but taps a *few* anchors rather than every line.

### 5. Sticky anchors through re-align
`applyRefinedAlignment` (and the mixed path) carry `timingAnchors` forward and
run `refitAroundAnchors` as a final step, so a re-align/gap-recovery pass never
discards user anchors — it fits its fresh timing to them.

## Data flow

**On open:** existing auto-passes run first (accept-if-better) → auto start/end
anchors detected + applied via `refitAroundAnchors` → remaining `needs_review`
runs are marked "tap to fix."

**On tap:** playhead → append `user` anchor → `refitAroundAnchors` on the
affected run → persist. No accept-if-better gate here (a user tap is ground
truth); only monotonicity + floor are enforced.

## Never-worsen invariants

- Anchored lines are exact; re-fit only moves lines *between* anchors → an
  anchored region structurally cannot collapse (the Recollect failure is
  impossible where anchors bound it).
- Weak edge signal ⇒ no auto start/end anchor, just the tap prompt.
- A `user` anchor always overrides an `auto-*` anchor on the same line.
- `timingAnchors` absent ⇒ output byte-identical to today.

## Testing

- `refitAroundAnchors`: pure unit tests — single anchor translates a run; two
  anchors rescale the run between them by weight; monotonicity + floor hold;
  empty anchors = identity.
- Auto start/end: strong-coverage fixture yields correct edge anchors; weak-edge
  fixture yields none.
- Sticky: a re-align over a song with a user anchor preserves that line's time.
- Corpus scorecard (`scripts/audit-corpus.mjs --check-baseline`): unchanged
  (no anchors present in fixtures ⇒ identity).
- Tap-to-anchor UI: RTL test — a tap appends an anchor and the run re-times.

## Phasing

- **Phase 1 (this spec):** anchor model, `refitAroundAnchors`, transcript-based
  auto start/end, tap-to-anchor UI, sticky anchors.
- **Phase 2 (later):** broaden silent auto-corrections (auto accurate-realign on
  block-timing, global offset/drift) to shrink the flagged set; upgrade
  start/end to the audio vocal-activity signal for sub-100ms precision.

## Risks / open questions

- **Re-fit quality between sparse anchors** on a wildly-off region: weighted
  interpolation is only as good as the anchor density. Mitigation: the flagged
  region is bounded by the nearest anchors, so error is capped; more taps = more
  precision.
- **Tap latency/accuracy**: the captured playhead may lag the true onset by
  audio-output latency. Mitigation: a small fixed offset, tunable; Phase 2's
  audio-VAD sidesteps it.
- **Tap UI in Play mode** (the design decision — you hear the onset while
  listening). If implementation surfaces a conflict with Play-mode gestures
  (seek, A/B loop), Edit-mode playback is the fallback surface.
