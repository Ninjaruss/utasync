# Drag to re-time: replacing tap-at-an-instant correction

**Date:** 2026-08-18
**Status:** Approved, ready for planning
**Thread:** C2 of a three-part UX audit (A = auto-align stall, shipped; B1/B3 shipped; C1 Phase 1 shipped)

## Problem

The user's original complaint was that manual timing is "very clunky and not very
intuitive". Investigating the anchor path turned up a specific, mechanical reason
rather than a stylistic one.

**Taps are treated as ground truth with zero latency compensation.**

`TapAnchorPrompt` commits the raw playhead at the moment of the click:

```ts
onClick: () => onAnchor(lineIndex, getTime())   // src/player/TapAnchorPrompt.tsx:32
```

`handleTapAnchor` (`src/player/PlayerView.tsx:702`) then pins the line to that time,
runs `refitAroundAnchors`, and sets `lineAlignmentQuality[lineIndex] = 'good'` — so
the line drops out of the flagged set and nothing revisits it. `TapSyncEditor` does
the same with a raw `audioPosition()` (`src/player/TapSyncEditor.tsx:47`).

Reaction time for "hear the line begin, then tap" is roughly 250–400ms. Every manual
correction is therefore **systematically late by a consistent margin, in one
direction**, and then locked in as truth. A user tapping carefully still produces
biased timings, which is exactly what "I fixed it and it still feels off" looks like.

A repo-wide search found no latency compensation of any kind.

## Findings

### 1. The accurate mechanic already exists, in the wrong place

`TimestampPopover` (`src/lyrics/TimestampPopover.tsx`) is a **drag** control with live
audio feedback: `onScrub` seeks as the user drags (`src/lyrics/EditMode.tsx:312`
wires it to `seek`), and the scrub window's centre is frozen at drag start so the
thumb tracks the finger instead of springing away.

Dragging carries no reaction-time error: the user adjusts until it matches, can
overshoot and correct, and hears the result continuously. It is the sound mechanic —
and it is buried in Edit mode behind a per-line popover.

### 2. The app deliberately routes users away from it

Edit mode sends timing fixes to the tap-anchor flow
(`src/player/PlayerView.tsx:1505`), and a comment there asserts "the reliable fix is
tapping a line as it plays". That belief is the inversion at the heart of this
thread: tapping is routed to *because* it is believed reliable, while being the only
mechanic with an uncorrected systematic bias.

Tapping is genuinely faster per line. The problem is not speed, it is that nothing
compensates what the speed costs.

### 3. The onset machinery exists and is unused at the tap site

`nearestOnset` (`src/ai-pipeline/vocalActivity.ts:146`) returns the strongest
onset-envelope peak near a target time, searching *backwards* as well as forwards.
Its own docstring describes the exact job needed here: "used to pull a late line
start back to the nearest genuine acoustic vocal onset".

It is not called from any correction path.

### 4. The signal it needs is computed and discarded

`VocalActivitySignal` is computed during alignment (`AutoAlignFlow.tsx:300`) and gap
recovery, then thrown away — it is not on the stored model in
`src/core/types/index.ts`. This is the same pattern as `durationSec` in thread C1: a
useful signal produced once and dropped, so nothing downstream can use it.

## Design

### Mechanic: a drag strip in Play mode, on the flagged line

The tap prompt becomes a compact inline drag control rather than a modal popover.
Dragging shifts *this line's* start while a short window around it loops, so the user
hears the match and sees the line highlight move together.

The essential property: **precision comes from the match, not from reflexes.** The
user can overshoot and correct, which a tap structurally cannot allow.

The drag adjusts the line's **start only**, matching what `handleTapAnchor` already
pins and what `TimingAnchor` stores. End times continue to come from the next line's
start via the existing rules. Editing an end deliberately remains `TimestampPopover`'s
job — this control replaces the tap, not the whole editor.

### Reuse the existing commit path

The control lands in `handleTapAnchor` unchanged — pin the line, `refitAroundAnchors`,
clear the uncertainty flag, undo toast. No new persistence, no new recovery path, no
change to how corrections are stored.

### Stay local — deliberately not the Phase 2 engine

This is **not** the global offset+scale fit designed for imported timings in
`2026-08-18-version-aware-lyric-sourcing-design.md`. Aligner output has a few bad
lines among many correct ones, and applying a global warp there is precisely the
failure `refitAroundAnchors` was built to avoid — its comment records the measurement,
**0.9s → 6s mean error** (`src/lyrics/anchorRefit.ts:34`).

The two features share a *mechanic* (drag with live feedback, not tap at an instant).
They do not share an engine, and the spec is explicit about that so a future reader
does not "unify" them into a regression.

### Onset snapping as an assist, not a second feature

Where a vocal-activity signal is available, mark detected onsets on the drag strip so
the drag can snap to real acoustic evidence. This folds the cheaper fix in as an
enhancement rather than a competing mechanism, and it degrades cleanly: on YouTube
songs there is no PCM, so the strip is plain drag-and-listen.

Whether this requires persisting `VocalActivitySignal` or recomputing it on entry to
correction mode is an implementation decision for the plan, and depends on measured
cost. Persisting is roughly 90KB per song as a typed array; recomputing costs a decode
plus FFT. **The plan must measure before choosing.**

## Testing

- The drag→time mapping is pure and directly unit-testable: given a strip width, a
  window, and a pointer position, what time results.
- Onset snapping is pure given a `VocalActivitySignal`. Constructing one
  synthetically is already an established pattern here — see
  `tests/lyrics/onsetSnap.test.ts`, `tests/ai-pipeline/vocalActivity.test.ts` and
  `tests/ai-pipeline/firstVocalOnset.test.ts`. Follow those rather than inventing a
  new fixture shape, and do NOT assume a stored signal exists on any song fixture:
  `VocalActivitySignal` is not persisted (finding 4).
- **The bias test that motivates the whole thread:** place a known onset in a
  synthetic signal, simulate a late tap (+250ms), and assert the snap recovers the
  onset within tolerance. Also assert the negative: a tap far from any onset, or a
  signal with no qualifying peak, must NOT be silently moved. Without both halves,
  the central claim of this spec is unverified and the snap could mask itself by
  moving everything.
- Component test that dragging updates the displayed time and that committing routes
  through the existing anchor path.

## Provisional — to be measured, not guessed

Both were flagged during design and must not be settled by intuition. Three thresholds
shipped on judgement earlier in this project were later refuted by measurement.

1. **Drag window width.** `TimestampPopover` uses ±6s (12s total), tuned for a
   different context — a modal with a context strip. The inline strip may want
   narrower. Pick from real use, not by copying the existing constant.
2. **Whether looping while dragging is pleasant or disorienting.** A short loop gives
   immediate feedback; it may also be maddening at speed. If it proves unpleasant,
   scrub-on-drag without looping (what `TimestampPopover` already does) is the
   fallback, and that is a legitimate outcome rather than a failure.

## Out of scope

- The Phase 2 global offset+scale fit (`linearTimingFit`, `SyncCalibrator`) for
  imported timings. Separate spec, separate engine.
- Changing `refitAroundAnchors` or any alignment behaviour.
- Removing `TimestampPopover`. It stays reachable for deliberate single-line editing,
  which it is good at; what changes is which path the user is led down first.
- Rebuilding Tap-through wholesale (thread C3). `TapSyncEditor` carries the same raw
  `audioPosition()` bias, but fixing it there is a larger change and is not attempted
  here.

## Success criteria

- A user correcting a flagged line no longer needs to hit an instant; they adjust
  until it matches and can revise freely.
- A correction is not systematically late. The simulated-late-tap test demonstrates
  the bias is removed rather than assumed.
- Corrections still commit through the existing anchor path, with undo intact.
- Songs without audio analysis (YouTube) keep a working correction path.
