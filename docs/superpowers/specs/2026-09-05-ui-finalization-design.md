# UI finalization: one screen model, one door, and an evidence-led simplification

**Date:** 2026-09-05
**Status:** Approved, ready for planning
**Thread:** Follows [[ux-qa-round-2026-08]] (74 findings, closed) and [[ux-quality-round-2026-09]] (two rounds, closed). Those were defect hunts. This is not.

## Scope decisions taken with the user before design

| Question | Answer |
|---|---|
| How much may be taken away? | **Structure first, then decide.** Harden navigation and run an honest inventory, then bring a demote/cut list to rule on with evidence. No unilateral removals. |
| Who is "most users"? | **Both phone and desktop, honestly split.** They are structurally different products: mobile is Manual tier and can never auto-align. The inventory runs twice. |
| Appetite | **One deep pass, take the time.** Restructure is on the table; long-lived branches are not. |

## Problem

Two prior rounds fixed defects and the app is materially more correct for it. Neither
asked whether the app is *too much*, and neither addressed why the same class of bug
keeps recurring.

**Nothing in this app can answer "what is on screen right now" in one place.**

What is displayed is a conjunction of scattered booleans in `PlayerView` — `mode`,
`alignMode`, `retimingLine`, `anchorTargetActive`, `showLyricsReimport`,
`pendingReplace`, `songMissing`, `lyricsLoading` — plus App-level `view`, `addOpen`
and `settingsOpen`, plus **15 `fixed inset-0` sites across 5 distinct z-index tiers**
(`z-30`, `z-40`, `z-50`, `z-[60]`, `z-[70]`) — 13 of them user-facing surfaces, 2
scrims/click-catchers. *(Corrected in Phase 1: the earlier figure of 7 was the count of
distinct `z-*` classes across all of `src/**/*.tsx`, which also picks up `z-10` — sticky
headers and the segmented-pill sliding indicator, in-flow stacking contexts rather than
layer tiers — and `z-20`. And the 15 sites are themselves an undercount of surfaces: see
the enumeration note below.)* `PlayerView.tsx` is 2,120 lines and holds 22 `useState` bindings;
`PlayerControls.tsx` is 1,815 lines with 35 buttons.

The consequence is that every new screen must remember to register itself in N
unrelated effects, and forgetting is silent.

**How surfaces are enumerated — corrected in Phase 1.** This spec originally told the
inventory to enumerate surfaces with `grep -rn "fixed inset-0" src --include='*.tsx'`.
That filter is wrong: it keys on a Tailwind positioning class instead of on the app's own
modal boundary, and it misses `src/core/ui/ConfirmDialog.tsx:31` (`absolute inset-0 z-20`,
**11 call sites**), the `DisplayMenu` panels (`src/player/DisplayMenu.tsx:337`, `:349` —
`role="dialog"`, `absolute`/`fixed z-50`, no `inset-0`), every anchored popover, and the
portalled menus in `PlayerControls`. The correct boundary is the `useModalDialog` hook —
the very hook `<Overlay>` wraps below — plus the dialog ARIA roles:

```bash
grep -rn "useModalDialog(" src --include='*.tsx'                    # 12 call sites
grep -rn 'role="dialog"\|role="alertdialog"' src --include='*.tsx'  # 16 hits
grep -rn "fixed inset-0" src --include='*.tsx'                      # 15 sites
```

Phase 1's audit ran all three and found **10 surfaces the original filter could not see**,
taking the registry from 20 rows to 30. Any later phase re-deriving the inventory must use
all three greps. The 15 `fixed inset-0` sites remain the correct count of *that* pattern
and are still the right migration list for Phase 2's first pass — they are just not the
surface inventory.

## Findings

### 1. Effects enumerate call sites, and the enumeration goes stale

The waveform-decode effect lists every screen that needs audio peaks:

```ts
if ((anchorTargetActive === null && mode !== 'edit' && alignMode !== 'offset') || !id) return
// src/player/PlayerView.tsx:829
```

`alignMode !== 'offset'` exists because the September round found `OffsetAlignScreen`
sitting on "Reading the audio…" indefinitely — it was, in that round's words, "a third,
unlisted call site". The global keyboard handler does the same thing one clause wide:

```ts
if (alignMode) return   // src/player/PlayerView.tsx:1403
```

It knows about `alignMode`. It does not know about `showLyricsReimport`,
`pendingReplace` or `retimingLine`.

### 2. The severe bugs from both rounds are one bug, five times

| Symptom | Mechanism |
|---|---|
| Tap-through had no exit and destroyed the YouTube iframe | an early `return` used as a screen |
| Offset screen was a dead end | `fixed inset-0 z-50` over the header, hand-rolled exits |
| Offset screen reopened after every later song write | hand-rolled one-shot guard (`src/player/PlayerView.tsx:1023`) |
| Offset waveform never loaded | the unlisted call site above |
| Space toggled playback from inside Settings | window-level handler unaware of overlays |

Each was fixed individually. The mechanism that produced them was not.

### 3. Cross-file invariants are held by CSS selectors and comments

`KEYSTROKE_OWNER` (`src/player/PlayerView.tsx:287`) is a selector string that decides
which keystrokes the global handler yields. Its docstring asserts an invariant:

> "Lyric rows are plain divs and match nothing here, so clicking a lyric and pressing
> Space still works." — `src/player/PlayerView.tsx:285`

That is no longer true. The August round gave lyric rows `role="button"` and
`tabIndex={0}` (`src/lyrics/LyricDisplay.tsx:432`), and tappable words the same
(`src/lyrics/LyricDisplay.tsx:110`). Both now match `KEYSTROKE_OWNER`. An accessibility
improvement in one file silently revoked a keyboard behaviour owned by another, no test
failed, and the comment documenting the invariant is now wrong.

The defect here is minor. The mechanism is not: **an invariant that spans files was
recorded as prose.**

### 4. The test suite is strong where it is cheap and absent where it matters

291 test files (207 logic, 84 component), plus two shared fixtures. Alignment and lyric logic are well covered.
But UI invariants are hand-written per surface — `tests/player/menus.escape.test.tsx`
tests Escape for exactly **two** surfaces (DisplayMenu, Edit-mode More) out of the 30
Phase 1 enumerated,
because each had to be written by hand. `tests/App.spine.test.tsx` covers three shallow
navigation cases. **No test walks a journey.** The September round observed that the
upload path "had never once been run end to end" before it drove it manually, and that
is where four real defects appeared.

### 5. Verified, not assumed

Grammar hints *do* render, inside the word-tap popover
(`src/lyrics/LyricDisplay.tsx:731`). The August finding "computed but never rendered"
is resolved. What remains is a discoverability question — they are reachable only by
tapping a word — which belongs to the inventory, not to a defect list.

## Design

### 1. The screen model

**Two axes, not one.** `play`/`edit` is a base mode; `tapSync`, `retimeLine` and
`offsetAlign` open *over* a base mode and return to it:

```ts
type Screen = { base: 'play' | 'edit'; overlay: Overlay | null }

type Overlay =
  | { kind: 'tapSync' }
  | { kind: 'offsetAlign' }
  | { kind: 'autoAlign' }
  | { kind: 'retimeLine'; lineIndex: number }
  | { kind: 'lyricsReimport' }
```

`songMissing` was in this draft union and has been **removed**: Phase 1 measured it as a
base state, not an overlay. `src/player/PlayerView.tsx:1647` is an early `return` that
replaces the player rather than layering over it, so there is no base mode underneath for
it to return to. It belongs on the `base` axis (audit registry row 9), not here.

`retimeLine` is kept, with a caveat recorded by Phase 1: as built, the surface behind it
(`DragRetimeStrip`, rendered at `src/player/PlayerView.tsx:1745` from `retimingLine` at
`:755`) is *inline in Play mode*, not a layer over it. Modelling it as an `Overlay` is a
deliberate reshaping — defensible, since it owns the waveform need that `screenNeeds`
exists to express — and should be taken as a decision to make in Phase 3, not a fact about
today's code. It is audit registry row 30.

A flat union cannot express "the retime overlay is open on top of edit mode", which is
a real state. It also mismodels the August critical: tap-through was written as a
*replacement* for the player when it is a *layer over* it, which is why entering it
unmounted `<YouTubePlayer>` and every tap stamped 0:00. The two-axis model makes that
structural rather than remembered.

`alignMode`, `retimingLine`, `showLyricsReimport`, `songMissing` and `mode` collapse
into this model (`songMissing` onto the base axis, the rest onto the overlay axis). Transitions run through one reducer, so "reopened after dismissal" becomes
unreachable rather than guarded by a `useRef`.

**Effects declare needs instead of enumerating call sites.**

```ts
function screenNeeds(s: Screen): {
  waveform: boolean
  youtubeIframe: boolean
  globalKeys: boolean
  audioEngine: boolean
  autoScroll: boolean
}
```

Needs fold across both axes: an overlay may *add* a need (waveform) without cancelling
the base's (the iframe stays mounted). Because `screenNeeds` switches exhaustively over
the union, **adding a screen without deciding whether it needs a waveform will not
compile.** Finding 1 becomes a type error.

**One door for every full-screen surface.** A shared `<Overlay>` component wrapping the
existing `useModalDialog` (`src/core/ui/useModalDialog.ts` — its DOM-containment
ownership reasoning is correct and is kept), adding scroll lock and browser/Android
Back. Its `onClose` prop is **required and non-optional**, making a dead-end overlay
unconstructable. The 13 `fixed inset-0` surface sites become one component and the 5
ad-hoc z-tiers become one layer scale; the 2 scrims stay as they are, since a backdrop is
not a dialog. Phase 2's migration list is not 13 but **30** — the surfaces Phase 1's
corrected sweep enumerated — of which the anchored menus and popovers may want a lighter
`<Overlay>` variant than the full-screen ones.

**App level too.** `view`, `addOpen` and `settingsOpen` fold into one `AppScreen` stack
so there is a single navigation model rather than two that happen to overlap. `App.tsx`
already contains careful, correct history handling (`pushedSongEntry`, the pop-not-push
rule in `leaveSong`) which is preserved as-is.

**Migration is strangler.** The model lands *alongside* the existing booleans, derived
from them. Surfaces migrate one at a time; each boolean is deleted only once nothing
reads it. Every commit ships.

**Not in this step:** splitting `PlayerView.tsx`. The split comes after, cutting along
seams the model exposes rather than seams guessed at now.

### 2. How the demote/cut list gets decided

**The registry falls out of the model.** Each surface carries metadata:

```ts
{ kind: 'autoAlign', reach: 'headline', devices: ['phone', 'desktop'],
  tiers: ['full', 'lite'], role: 'core' }
```

`reach` is one of `auto | headline | menu | precondition`. `tiers` ⊆
`full | lite | manual`, from `getDeviceTier()`.

**`tiers` is separate from `devices`, and replaces the `devices: ['desktop']` shorthand
this example originally used.** Device class is viewport and pointer; tier is WebGPU plus
memory. A desktop can be `lite` or `manual`; a phone is always `manual`. Auto-align is not
desktop-only — it is `full`/`lite`-only (`autoAlignSupported={getDeviceTier() !== 'manual'}`,
`src/player/PlayerView.tsx:1900`), and it is reachable on a hypothetical full-tier phone.
Collapsing the two axes loses exactly the fact this spec calls the structural difference
between the two products: *mobile is Manual tier and can never auto-align.* With `tiers`
as its own column, "what disappears on Manual tier?" is a filter over the registry rather
than prose in a notes field. This is the first time the
full surface inventory is a readable list, which is the precondition for deciding
anything about it.

**Evidence comes from driving the app, not reading it.** Two live inventories, using
the fetch-stub plus `DataTransfer` injection technique documented in
[[ux-quality-round-2026-09]] with the real mp3s in `public/e2e/`:

- **Journey A — phone, Manual tier:** YouTube link → auto-fetched LRC → play. No AI at all.
- **Journey B — desktop, Full tier:** mp3 upload → auto-align → play.

Three numbers per journey: decisions before the lyrics first follow the music; distinct
surfaces met; interactive controls visible in the default player viewport without
opening a menu. These are the baseline that
"simple" is measured against.

**Demotion criterion:**

> A surface earns default visibility only if the median user needs it to reach *"the
> lyrics follow the music and I can study them."* Everything else is revealed by
> precondition, or sits one level down.

Applied in preference order:

1. **Precondition reveal** — the control exists only when it can act. Auto-align only
   with local audio; A/B export only with timed lines *and* local audio. No feature
   lost, no clutter. Expected to absorb most of the list.
2. **One level down** — into `DisplayMenu`, More, or Settings.
3. **Cut** — only for what nothing reaches and nothing needs. Expected to be very short,
   possibly empty.

**Hypothesis to test, not a conclusion:** a visible share of `PlayerControls`' 35
buttons is loop-playlist machinery (Saved loops, Rename, Move up, Move down, Remove,
Plays before next loop) living on the surface a beginner meets while trying to follow a
song.

**Tested and REFUTED** in Phase 1's audit: exactly **1** of those 6 controls — the "Saved
loops" entry point — is on the default player surface. The other five render per-loop and
do not exist for a first-time user with zero saved loops. The machinery is already
correctly disclosed; only that single entry point reaches Phase 5's table, as its weakest
row.

**Deliverable:** a ranked table — surface / current reach / proposed reach / evidence /
risk — that the user rules on row by row. Nothing is demoted unilaterally.

### 3. Preventing the recurrence, in four tiers

Auditing has no fixed point: August found 74, September found more, including four on a
screen August walked past. A third audit would find a third set. What converges is
making the recurring class unrepresentable and catching the residue earlier.

**Tier 1 — the compiler.** `screenNeeds` exhaustive over the union; `<Overlay>` requires
a non-optional `onClose`. Free after migration. Would have prevented the never-loading
waveform and both dead ends.

**Tier 2 — one table test over the registry.** For every surface: a visible exit
control, Escape closes, focus moves in, focus restores on close, Back closes rather than
leaving the app. Because it iterates the registry, **a new surface is covered the moment
it is registered** — replacing today's two hand-written Escape tests.

**Tier 3 — journey tests, one per device.** Journeys A and B run end to end with the
real mp3s. Their value is not their assertions but that they execute the real flow,
which is where September's defects lived.

**Tier 4 — lint as ratchet.** The rule is keyed on the **modal boundary**, not on a
Tailwind class — a `fixed inset-0`-only rule would have caught neither `ConfirmDialog`'s
`absolute inset-0` nor `DisplayMenu`'s portalled `fixed z-50`, which is the same blind
spot that made the original inventory incomplete. Concretely:

- No direct `useModalDialog(` call outside `<Overlay>`'s own implementation — this is the
  boundary the app already uses, so the rule catches every current surface and every
  future one written the app's way.
- No `role="dialog"` / `role="alertdialog"` / `role="menu"` element rendered outside an
  `<Overlay>`, with an explicit, commented allowlist for anything deliberately excluded.
- No `fixed inset-0` outside `<Overlay>`, with an explicit allowlist for the two scrims —
  kept as a third, narrower clause rather than the whole rule.
- No `window.addEventListener('keydown')` outside the single keyboard owner. Phase 1 found
  three surfaces with hand-rolled or missing dismissal (`PlayerControls.tsx:736`, `:1237`,
  `:1412`), which this clause plus the first one together retire.

**Policy change:** where an invariant spans files it becomes a test, not a comment. The
`KEYSTROKE_OWNER` case gets one — *Space with a lyric row focused does X* — so the next
accessibility change either preserves it or changes it deliberately.

**Explicitly not proposed:** a third full-app audit.

### 4. Phases

Each merges to main on its own; none requires the next.

| # | Phase | Ships | Risk |
|---|---|---|---|
| 1 | **Inventory & baseline** — drive both journeys live, record the three numbers, draft the demote table | Committed audit doc, no code | None |
| 2 | **`<Overlay>` primitive** — required `onClose`, focus, Escape, scroll lock, Back; migrate the 30 registered surfaces one at a time; Tier-2 test grows as they land | Per surface | Low, reversible |
| 3 | **Screen model** — two-axis state, move effects onto `screenNeeds`, delete orphaned booleans | Incrementally | **Highest** |
| 4 | **App-level stack** — fold `view`/`addOpen`/`settingsOpen` into one stack | Once | Low-moderate |
| 5 | **Demote decisions** — table presented, user rules, approved rows implemented | Per decision | Low |
| 6 | **The split** — decompose `PlayerView`/`PlayerControls` along exposed seams | Once | Low by then |
| 7 | **Journey tests + lint ratchet** | Once | None |

**Planning cadence:** phases are planned and executed one at a time, not as a single
implementation plan. Phase 1's output feeds Phase 2's plan, and Phase 5 cannot be
planned at all until the user has ruled on the table.

**Why inventory is first:** the union's membership cannot be derived from code alone —
September found the offset screen precisely because it was an unlisted call site that
reading had missed. Running the app first makes membership factual. It also captures the
baseline *before* any change, so Phase 5's improvement is measurable rather than
asserted.

**Why Overlay precedes the screen model:** migrating each surface to a common door forces
its real lifecycle into the open, one at a time, which is what makes the union's shape
obvious instead of guessed.

## Risks

1. **Long-lived branch.** Mitigated by the strangler migration: the model is derived from
   existing booleans at first, main is always shippable, no phase blocks on the next.
2. **Touching alignment by accident.** `src/ai-pipeline` alignment math is out of scope;
   this pass changes the UI layer around it. The existing suite is the guard, and any
   movement in alignment baselines means the boundary was crossed.
3. **Phase 3 may not fit some surface.** If the two-axis model does not accommodate one,
   stop and return to the user rather than bending the model. Phases 1, 2 and 4-7 stand
   alone if 3 is deferred.

## Non-goals

- No new features.
- No visual redesign.
- No alignment-accuracy work.
- No 320px header redesign — September parked this deliberately; 375px is the real phone floor.

## Success criteria

1. `screenNeeds` is the single source for waveform, iframe, keyboard and autoscroll
   lifetimes; no effect enumerates screens by name.
2. Every registered surface renders through `<Overlay>`; no direct `useModalDialog` call
   and no dialog/menu-role element outside it, and no `fixed inset-0` outside it or the
   scrim allowlist.
3. The Tier-2 table test covers 100% of registered surfaces, and a newly registered
   surface is covered without editing the test. **The two hand-written Escape tests are
   retired only once the registry-driven test demonstrably covers the surfaces they
   covered** — `DisplayMenu` and the Edit-mode "More" menu, audit registry rows 21 and 22,
   neither of which the original `fixed inset-0` inventory contained. Replacing them
   against an incomplete registry would have reduced coverage while reporting 100%.
4. Both journeys run green as tests.
5. Baseline numbers from Phase 1 are re-measured after Phase 5, and the change is
   reported honestly — including if a number did not move.
