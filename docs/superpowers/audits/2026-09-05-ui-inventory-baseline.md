# UI inventory & baseline

**Date:** 2026-09-05
**Phase:** 1 of `docs/superpowers/specs/2026-09-05-ui-finalization-design.md`
**Status:** Complete — awaiting user decisions on the demote/cut table

## Harness

How each tier was reached, and proof it was reached.

Dev server: started via the Browser pane's `preview_start` tool with the `.claude/launch.json`
config named `dev` (`npm run dev`, `autoPort: true`). It reported origin
`http://localhost:5173` for this run — if a future run reports a different port (because
5173 was taken), substitute that origin everywhere below; the navigation sequence itself
does not change.

Tier logic lives in `src/ai-pipeline/capability.ts`:

```ts
if (gpu && memory >= 6) return 'full'
if (gpu && memory >= 4) return 'lite'
if (!isMobileBrowser(nav) && memory >= 6) return 'lite'
return 'manual'
```

`isMobileBrowser` checks `navigator.userAgentData.mobile`, falling back to
`/Android|iPhone|iPad|Mobi/i` on the UA string. The Browser pane's `resize_window`
`mobile` preset emulates an Android Chrome user agent, satisfying that check. The
dev-only `?webgpu=off` query switch forces `hasWebGPU()` false and persists in
`sessionStorage`, surviving reloads and in-app navigation — it must be explicitly
cleared with `?webgpu=on` before the desktop journey, or Journey B silently runs at
the wrong tier. Manual tier needs **both** the mobile preset (for `isMobileBrowser`)
and `?webgpu=off` (for `gpu`); `?webgpu=off` alone on a desktop UA falls through to
`'lite'`, not `'manual'`. The tier is read at page load, so any preset/query change
must be followed by a reload before re-checking the tier.

### Manual tier (Journey A)

Exact navigation sequence (order matters — the reload must come last):

```
navigate      → http://localhost:5173/?webgpu=off
resize_window → preset: "mobile"
navigate      → http://localhost:5173/?webgpu=off      (reload so the gate re-runs)
```

Recorded via `javascript_tool`:

```js
const cap = await import('/src/ai-pipeline/capability.ts')
JSON.stringify({
  tier: cap.getDeviceTier(),
  webgpu: cap.hasWebGPU(),
  mobileUA: /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent),
  deviceMemory: navigator.deviceMemory ?? null,
  cores: navigator.hardwareConcurrency,
})
```

Reading (verbatim):

```json
{"tier":"manual","webgpu":false,"mobileUA":true,"deviceMemory":16,"cores":10}
```

Manual tier is confirmed reachable on this machine. Gate passed — proceeding to
Journey B / Full tier and to Tasks 2–5.

### Full tier (Journey B)

Exact navigation sequence (order matters — the reload must come last):

```
navigate      → http://localhost:5173/?webgpu=on
resize_window → preset: "desktop"
navigate      → http://localhost:5173/?webgpu=on
```

Recorded with the same Step-3 snippet as above.

Reading (verbatim):

```json
{"tier":"full","webgpu":true,"mobileUA":false,"deviceMemory":16,"cores":10}
```

This machine reports `"full"` (16GB device memory, WebGPU available under the
`resize_window` `desktop` preset), so Journey B documents the Full tier as planned —
no Lite-tier fallback was needed.

To return to either tier for later journey tracing (Tasks 2–3), replay the exact
navigation sequence above for that tier — the mobile/desktop preset switch and the
`?webgpu=` query param must both be set before the final reload, since the tier is
only evaluated at page load.

## Journey A — phone, Manual tier

**Run:** 2026-09-07, viewport 375x812, tier reading
`{"tier":"manual","webgpu":false,"mobileUA":true,"deviceMemory":16,"cores":10}`.
State cleared first (`utasync` IndexedDB deleted, localStorage cleared, `landingSeen: null`
confirmed) so this is a genuine first visit.

**Determinism:** `lrclib.net` and `itunes.apple.com` were stubbed; `www.youtube.com` and
`img.youtube.com` reached the real network, because the journey needs the real embed UI.
This journey therefore requires network access and is not hermetic. The stub deliberately
returns a *non-matching* song ("Guitar / Test") so the mismatch guard is exercised.

**Song used:** `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → oEmbed resolved
"Never Gonna Give You Up · Rick Astley".

### Trace

| # | Surface | How it appeared | Exits offered | Notes |
|---|---|---|---|---|
| 1 | Landing | `auto` (first visit) | "Get started →", "Open the app →", "Open the app" | Three CTAs, all the same action |
| 2 | Library (empty) | `auto` after landing | — (root view) | Empty state; only 2 controls: ⚙ Settings, ＋ Add a song |
| 3 | Onboarding carousel, 3 steps | `auto`, over Library | Skip (steps 1–2); Back / Done (step 3) | Must be cleared before the library is usable |
| 4 | Add-song sheet | `headline` (＋ Add a song) | ✕ Close | Opens on **Upload audio**, marked RECOMMENDED |
| 5 | Add-song → YouTube link tab | `menu` (tab within the sheet) | ✕ Close | Honest LIMITATIONS list: "No AI auto-align or clip export" |
| 6 | Lyrics-found confirm (mismatch) | `auto`, inline in the sheet | "Yes, this is the right song" / "Use different lyrics" | Gates the commit: **"Add song" is disabled until resolved** |
| 7 | Player, Play mode | `auto` after Add song | ← Back | No alignment screen — correct: lyrics arrived synced, so `chooseAutoAlignment` returned `null` |

### Numbers

Two counts are reported for "decisions", because the single number is contestable and
the distinction turned out to matter:

**Counting rule for "distinct surfaces met" (applies to both journeys).** The first
draft of this audit counted the two journeys differently — Journey A counted its inline
gating panel and Journey B did not — so the two numbers were not comparable. The rule,
stated once and applied to both:

> A **surface** is a distinct panel of UI that presents its own controls or its own
> decision, whether it is a full overlay, a tab within an open sheet, or an inline block
> inside one. An **advisory banner** — copy plus a button that opens some *other* surface
> — is not a surface. Transient self-dismissing overlays (registry rows 15 and 20) are
> excluded from both journeys, since neither trace recorded them and "seen live" for them
> is genuinely ambiguous.

Under this rule Journey A is **7** (unchanged) and Journey B is **6** (was 5 — the
filename-ambiguity helper, registry row 7, has its own copy and its own "Swap title and
artist" control and had been silently omitted). The rule is trace-level, not
registry-level: it counts panels the user actually met, so Journey A's YouTube-link tab
counts even though it is part of registry row 5. For anyone who prefers the stricter
registry-row count, the equivalents are A **6** and B **5**; Phase 5 must re-measure with
whichever of the two it states, and the numbers below use the trace-level rule.


| Measure | Value |
|---|---|
| Decision points (choose among ≥2 options, or supply input) | **5** — enter app; dismiss onboarding; choose source; paste URL; resolve mismatch |
| Required interactions (clicks + inputs) | **9** — landing CTA, Next, Next, Done, YouTube tab, paste, Continue, confirm match, Add song |
| Distinct surfaces met | **7** |
| Controls in default player viewport | **16 total, 3 lyric rows, 13 non-lyric** |

The 13 non-lyric controls: ← Back, Play, Edit, Settings, Lyrics display options,
Add audio file, Seek, Rewind 5 seconds, Start playback, Forward 5 seconds, Loop,
Speed 100 percent, Saved loops.

### Endpoint caveat — read before trusting the "first synced playback" framing

Playback could **not** be confirmed in this environment. The Browser pane runs as a
hidden tab (`document.hidden === true`, `visibilityState: "hidden"`) and a scripted
`.click()` is not a trusted user gesture, so the YouTube embed does not begin playing.
The iframe itself is present and correctly configured
(`embed/dQw4w9WgXcQ?autoplay=0&rel=0&playsinline=1&origin=...`).

**This is not filed as a defect.** The journey is therefore measured to "player open,
lyrics present and timed, transport rendered" rather than to observed playback. Every
number above is unaffected — none of them depends on the audio actually running.

### Evidence: endpoints actually requested

14 LRCLIB requests were issued for this one song (`/api/get` ×2, `/api/search` ×12),
plus one YouTube oEmbed and one caption fetch. Recorded as an observation, not a defect —
`cachedFetchJson` de-duplicates and the session halts on rate-limit/offline.

## Journey B — desktop, Full tier

**Run:** 2026-09-07, viewport 1280x800, tier reading
`{"tier":"full","webgpu":true,"mobileUA":false}`. State cleared first
(`landingSeen: null` confirmed). Same lrclib/itunes stub as Journey A.

**Note on viewport:** `resize_window` preset `desktop` clears emulation, and on a hidden
pane that leaves `innerWidth/innerHeight` at **0**, which silently zeroes any in-view
measurement. An explicit `1280x800` was used instead. Anyone re-running this must do the
same or the control count will come back 0.

**Song used:** `public/e2e/guitar.mp3` (3,663,980 bytes) injected as `Test - Guitar.mp3`
via the `DataTransfer` technique. This exercised decode, metadata extraction, ingest and
lyrics search for real.

### Trace

| # | Surface | How it appeared | Exits offered | Notes |
|---|---|---|---|---|
| 1 | Landing | `auto` (first visit) | 3 identical CTAs | Same as Journey A |
| 2 | Library (empty) | `auto` after landing | — (root view) | Same 2 controls |
| 3 | Onboarding carousel, 3 steps | `auto`, over Library | Skip; Back / Done | Same as Journey A — not tier-aware |
| 4 | Add-song sheet, **Upload audio** tab | `headline` (＋ Add a song) | ✕ Close | Default tab, so no source choice needed on this path |
| 5 | Player, Play mode | `auto` after Add song | ← Back | No alignment screen — lyrics arrived synced, so `chooseAutoAlignment` returned `null` despite `autoAlign: true` being passed |

**Filename-ambiguity helper (in surface 4):** title and artist were both derived and
tagged `FROM FILENAME`, with the copy "Filename could be 'Artist – Title' or
'Title – Artist'. Swap if the fields look reversed." and a **Swap title and artist**
button. Good `precondition` behaviour — it appears because the source was a filename.
**Counted** as a distinct surface in this journey's numbers (registry row 7), per the
counting rule in Journey A: it carries its own copy and its own control.

**Provenance nudge (in surface 5):** the player showed
"Lyrics not lining up? These timings came from a lyrics database. **Line them up**".
Another `precondition` reveal, keyed on lyric provenance. Not counted as a separate
surface — it gates nothing.

### Numbers

| Measure | Value |
|---|---|
| Decision points | **4** — enter app; dismiss onboarding; choose the audio file; verify title/artist |
| Required interactions | **7** — landing CTA, Next, Next, Done, ＋ Add a song, choose file, Add song |
| Distinct surfaces met | **6** — the 5 trace rows plus the filename-ambiguity helper (registry row 7), per the counting rule stated in Journey A |
| Controls in default player viewport | **17 total, 3 lyric rows, 14 non-lyric** |

The 14 non-lyric controls: ← Back, Play, Edit, Settings, Line them up, Lyrics display
options, Seek, Rewind 5 seconds, Start playback, Forward 5 seconds, Volume, Loop
(Tap to set), Speed (Normal 1x), Open saved loops.

**Journey B is shorter than Journey A** (4 decisions vs 5, 6 surfaces vs 7) because the
Upload tab is the default and the stubbed lyrics matched the filename-derived metadata
exactly, so no mismatch confirmation was needed. Journey A's extra steps are the source
switch and the mismatch guard.

### Endpoint caveat

As in Journey A, playback could not be confirmed — hidden tab, no trusted user gesture.
Measured to "player open, lyrics present and timed, transport rendered".

## Consolidated surface list

### Step 1 — static re-derivation

**Correction: the filter the spec and plan prescribed is the wrong one, and this sweep
does not use it.** Both documents specify `grep -rn "fixed inset-0" src --include='*.tsx'`.
That filter is keyed on a Tailwind positioning class rather than on the app's own modal
boundary, and it silently misses whole classes of surface:

- `src/core/ui/ConfirmDialog.tsx:31` is `absolute inset-0 z-20` — scoped to its parent
  sheet rather than the viewport, so `fixed inset-0` never sees it. It has **11 call
  sites** (`LibraryScreen.tsx:169`, `SettingsView.tsx:302`, `PlayerControls.tsx:973`,
  `AddSongSheet.tsx:172,183`, `TapSyncEditor.tsx:101`, `AutoAlignFlow.tsx:776,802,812`,
  `PlayerView.tsx:2012,2054`).
- `src/player/DisplayMenu.tsx:337` and `:349` are `role="dialog"` panels positioned
  `absolute … z-50` and (portalled) `fixed z-50`, with no `inset-0` on either.
- Every anchored popover (`WordLookupPopover`, `TimestampPopover`,
  `TranslationRepairPopover`) and every portalled menu in `PlayerControls` is likewise
  invisible to it.

This matters beyond bookkeeping: the plan states that Phase 3's `Overlay` union
membership is taken from this list, and the spec's success criterion 3 says a
registry-driven table test **replaces** today's two hand-written Escape tests. Those two
tests cover `DisplayMenu` and the Edit-mode "More" menu (`tests/player/menus.escape.test.tsx`)
— neither of which the `fixed inset-0` filter finds. Replacing them from a registry built
on that filter would have *reduced* Escape coverage while reporting 100%.

**Corrected sweep method.** The app's real modal boundary is the `useModalDialog` hook
(`src/core/ui/useModalDialog.ts`) — the very hook the spec says `<Overlay>` will wrap —
plus the ARIA roles that mark a surface as a dialog. Three greps, unioned, then
reconciled against the live traces:

```bash
grep -rn "useModalDialog(" src --include='*.tsx'                    # 12 call sites
grep -rn 'role="dialog"\|role="alertdialog"' src --include='*.tsx'  # 16 hits
grep -rn "fixed inset-0" src --include='*.tsx'                      # 15 sites
```

Anyone re-running this inventory must run all three. `fixed inset-0` alone is not
sufficient and never was.

Results on this branch:

- **`fixed inset-0` → 15 sites**, matching the spec's expected count exactly, so there
  is no drift in *that* number to record. 13 are user-facing surfaces; 2 are scrims,
  confirmed at the exact lines the spec named:
  - `src/lyrics/EditMode.tsx:648` — `aria-hidden` click-catcher that closes the lyric-row
    "More" menu on outside click.
  - `src/player/PlayerControls.tsx:1409` — backdrop `<button>` of the shared mobile
    controls `Sheet` (`MobileControlsSheet`, used by the Saved-loops panel).
- **`useModalDialog` → 12 call sites.** Four of them belong to surfaces the `fixed
  inset-0` grep never returned: `TimestampPopover.tsx:147`, `EditMode.tsx:377` (the
  "More" menu itself — only its *scrim* was in the 15), `TranslationRepairPopover.tsx:30`,
  `WordLookupPopover.tsx:28`, plus `ConfirmDialog.tsx:26` and `DisplayMenu.tsx:278`.
- **`role="dialog"|"alertdialog"` → 16 hits, 15 of them real markup.** The sixteenth,
  `src/player/PlayerView.tsx:290`, is the `KEYSTROKE_OWNER` selector *string*, not a
  surface — it is the app already naming this same boundary, one file away from the
  effects that get it wrong.

**Observation for Phase 2 (recorded, not fixed):** three of the newly found surfaces —
`PlayerControls.tsx:736`, `:1237` and `:1412` — do not use `useModalDialog` at all. The
first two dismiss on `pointerdown` only, with no Escape handler (`PlayerControls.tsx:620`,
`:1193`); the third hand-rolls its own `keydown` listener (`:1399`). They are exactly the
"one door" cases the `<Overlay>` migration exists to absorb.

### Step 2 — reconciliation

The union below is **not** limited to the 15 grep hits. Two of the app's true surfaces
are reached by an early `return` and an inline mode-swap — neither has a `fixed inset-0`
root, so grep alone would never find them, and neither journey happened to visit them
either. That is a fourth case the brief's three buckets don't literally name, and it is
called out on its own below because it is the exact shape of the August critical
(tap-through as an early `return` in `PlayerView`) and therefore the highest-value catch
in this task.

**Bucket 1 — seen live and found statically (5):** Landing, Library, Player (song view),
Onboarding carousel, Add-song sheet. (Landing/Library/Player are base routes from
`App.tsx`'s `View` union, not overlays, so they don't appear in the `fixed inset-0` grep
— they're included here because Step 3's registry is the *true surface list*, and the
task brief's own "Base or overlay" column only makes sense if base routes are rows too.)

**Bucket 2 — found statically, never seen live (11):** Settings sheet, the auto-align
confirm dialog, "Fix word pairing" (AlignmentEditor from Edit mode), the second-language
panel, its messy-paste AlignmentEditor phase, the Replace-lyrics dialog, the Tap-sync
editor, the Offset-align screen, the Auto-align flow, and the two generic transient
overlays (`ProgressOverlay`, `LoadingOverlay`) — see the per-row notes below for the
one-line "what would reach it."

**Bucket 3 — seen live, NOT a `fixed inset-0` site (2):** the lyrics-found mismatch
confirm (`LyricsFoundConfirm`, inline in the Add-song sheet — already logged in Journey
A's trace) and the filename-ambiguity helper (inline in the Upload-audio tab — logged in
Journey B's trace). Both are real, gated-or-conditional pieces of UI implemented as plain
JSX inside an already-open sheet, not as their own overlay.

**Bucket 4 — found by reading the code, caught by neither the live traces nor the grep
(2):** this is the dangerous case the brief warns about.
- **Edit mode** (`src/lyrics/EditMode.tsx`, switched to at `src/player/PlayerView.tsx:1879`
  by the Play/Edit toggle) has no `fixed inset-0` root at all — it's an inline swap inside
  `PlayerView`'s own flex layout, sharing the `PlayerControls` sidebar with Play mode.
  Neither journey ever toggled to it (both traces show Play mode only), so it is invisible
  to both the live traces and the grep. It is nonetheless a full, distinct interaction
  surface (undo/redo, a "More" menu, Auto-align, Tap-through, gap-recovery banners) and
  belongs in Phase 3's union.
- **Song-not-in-library** (`src/player/PlayerView.tsx:1647`, an early `return` before the
  main player JSX, guarded by `if (songMissing)`) replaces the entire Player with a
  "This song isn't in your library" message and a single "Back to library" exit. It fires
  on a precondition — a hash-route deep link (`#/song/<id>`) to a song absent from this
  device's storage — that neither journey exercised (both added a fresh song and viewed
  it immediately). This is the same shape as the documented August critical: an early
  `return`, not an overlay.

**Bucket 5 — found only by the corrected sweep, missed by the `fixed inset-0` filter and
by both live traces (10):** this bucket did not exist in the plan, because the plan
inherited the spec's wrong filter. Every row here is a `useModalDialog` and/or
`role="dialog"` surface with no `fixed inset-0` root.

- **Word-tap lookup popover** (`src/lyrics/WordLookupPopover.tsx:118`, hook at `:28`),
  opened from `LyricDisplay.tsx:728` by tapping a word on the active line. `fixed`, but
  anchored (`fixed w-72` / `fixed inset-x-3`), `z-30`.
- **Line-timing popover** (`src/lyrics/TimestampPopover.tsx:222`, hook at `:147`), opened
  from Edit mode's per-line timestamp button (`EditMode.tsx:333`, `:480`, `:808`).
  `absolute z-20`.
- **Translation-repair popover** (`src/lyrics/TranslationRepairPopover.tsx:38`, hook at
  `:30`), opened from `LyricDisplay.tsx:409` on a line with repair candidates.
  `absolute z-20`.
- **`DisplayMenu` panel** (`src/player/DisplayMenu.tsx:337` desktop / `:349` mobile
  portal, hook at `:278`) — the panel behind the "Lyrics display options" trigger that
  *both* journeys' default-viewport control lists already record. One of only two
  surfaces with an Escape test today.
- **Edit-mode "More" menu** (`src/lyrics/EditMode.tsx:649`, `role="menu"`, hook at
  `:377`). Only its scrim (`:648`) was in the 15. It is the other surface with an Escape
  test today, and it is the doorway to registry rows 12, 13, 16 and 17.
- **Generic `ConfirmDialog`** (`src/core/ui/ConfirmDialog.tsx:31`, hook at `:26`) —
  `absolute inset-0 z-20`, 11 call sites.
- **"Repeats before next loop" menu** (`src/player/PlayerControls.tsx:736`), portalled
  `fixed z-[60]`.
- **"More playback options" menu** (`src/player/PlayerControls.tsx:1237`), portalled
  `fixed z-[60]`.
- **Mobile controls sheet** (`src/player/PlayerControls.tsx:1412`, `MobileControlsSheet`)
  — the panel whose *backdrop* (`:1409`) was registered as a scrim while the panel itself
  was not. This is the sheet the demote table's row 2 describes opening ("Saved" chip,
  `PlayerControls.tsx:1759`) to find the empty state.
- **Drag-retime strip** (`src/player/DragRetimeStrip.tsx:58`, rendered at
  `src/player/PlayerView.tsx:1745`) — inline, no dialog role, found by following the
  spec's own `retimeLine` union member back to source (see the note under the registry).

**Scope of the registry, stated explicitly.** All ten are added as rows. The registry is
**not** limited to full-screen surfaces — it never was, since rows 6 and 7 are inline
panels inside an open sheet and rows 8 and 9 are base-level swaps. The boundary drawn
here is: *anything that owns keystrokes, focus, or the Escape key, or that gates the
user's progress, is a surface.* Anchored menus and popovers qualify on the first clause;
inline gating panels on the second. Purely decorative inline elements — banners that
gate nothing — do not, which is why the "Line them up" nudge stays out (below).

The excluded case: the **"Line them up" provenance nudge** (inline banner in
`PlayerView.tsx`, ~line 1783, seen live in Journey B) is *not* given its own row below.
The existing Journey B section already states explicitly why: "Not counted as a separate
surface — it gates nothing." Its own action button (**Line them up**) is what opens a real
surface, `OffsetAlignScreen` (row 19 below) — the banner itself is decoration on the
Player, not a screen.

### Step 3 — registry

`reach` ∈ `auto | headline | menu | precondition`. `devices` ⊆ `phone, desktop` — every
surface below is reachable on both device classes; none is device-gated.

**A third axis: `tiers`.** `tiers` ⊆ `full | lite | manual`, from
`getDeviceTier()` (`src/ai-pipeline/capability.ts`). This column is an addition to the
metadata shape the spec sketched, and it **supersedes the spec's `devices: ['desktop']`
shorthand** for capability-gated surfaces. The spec's worked example uses `devices` to
express what is really a tier gate, and the two are not the same axis: device class is
viewport and pointer, tier is WebGPU plus memory. A desktop can be `lite` or even
`manual`; a phone is always `manual`. Collapsing them loses exactly the fact the spec
calls the structural difference between the two products — *mobile is Manual tier and can
never auto-align* — which without this column survives only as English prose in row 19's
notes. With it, "which surfaces vanish on Manual tier?" is a column filter: rows 11 and
19, and nothing else.

| # | Surface | File:line | reach | devices | tiers | role | Base or overlay | Exits |
|---|---|---|---|---|---|---|---|---|
| 1 | Landing | `src/landing/LandingScreen.tsx` (routed `App.tsx:156`) | auto (first visit only) | phone, desktop | full, lite, manual | core | Base | 3 identical CTAs → Library |
| 2 | Library | `src/sources/LibraryScreen.tsx` (routed `App.tsx:167`) | auto (default/returning route) | phone, desktop | full, lite, manual | core | Base | ＋ Add a song, ⚙ Settings, open a song |
| 3 | Player (song view) | `src/player/PlayerView.tsx` (routed `App.tsx:159`) | headline (open a song) | phone, desktop | full, lite, manual | core | Base | ← Back |
| 4 | Onboarding carousel | `src/core/ui/Onboarding.tsx:56` | auto (first visit, over Library) | phone, desktop | full, lite, manual | core | Overlay | Skip / Back / Done |
| 5 | Add-song sheet | `src/sources/AddSongSheet.tsx:154` | headline (＋ Add a song) | phone, desktop | full, lite, manual | core | Overlay | ✕ Close; Add song (commit) |
| 6 | Lyrics-found confirm (mismatch) | `src/lyrics/LyricsFoundConfirm.tsx` (inline; used from `LinkParser.tsx:397`, `UploadAudioFlow.tsx:475`, `LyricsImportPanel.tsx:186`) | auto (inline in Add-song sheet, once a match needs confirming) | phone, desktop | full, lite, manual | core | **Inline — not `fixed inset-0`** | "Yes, this is the right song" / "Use different lyrics" — gates the sheet's commit |
| 7 | Filename-ambiguity helper | inline in `src/sources/AddSongSheet.tsx` (Upload tab) | precondition (title/artist derived from filename) | phone, desktop | full, lite, manual | advanced | **Inline — not `fixed inset-0`** | "Swap title and artist" (non-gating) |
| 8 | Edit mode (lyrics editor) | `src/lyrics/EditMode.tsx`, switched at `src/player/PlayerView.tsx:1879` | menu (Play/Edit toggle in Player header) | phone, desktop | full, lite, manual | core | **Base — inline mode-swap, no `fixed inset-0` root; not seen live** | Toggle back to Play |
| 9 | Song-not-in-library | `src/player/PlayerView.tsx:1647` (early `return`) | precondition (deep link to a songId not in local storage) | phone, desktop | full, lite, manual | core | **Base — early `return`, no `fixed inset-0` root; not seen live** | "Back to library" |
| 10 | Settings sheet | `src/settings/SettingsSheet.tsx:19` | menu (⚙ Settings, present on Library and Player) | phone, desktop | full, lite, manual | core | Overlay | ✕ / backdrop close |
| 11 | Auto-align confirm | `src/lyrics/EditMode.tsx:837` | headline (Edit mode's "Auto-align" button; only when `hasLocalAudio && autoAlignSupported`) | phone, desktop | **full, lite** — `autoAlignSupported={getDeviceTier() !== 'manual'}` (`PlayerView.tsx:1900`) | core | Overlay | Cancel / Continue |
| 12 | Fix word pairing (AlignmentEditor from Edit mode) | `src/lyrics/EditMode.tsx:861` | menu (Edit mode → More → "Fix word pairing"; only when `hasSecondLang`) | phone, desktop | full, lite, manual | advanced | Overlay | onConfirm / onCancel |
| 13 | Second-language panel | `src/lyrics/SecondLanguagePanel.tsx:246` | menu (Edit mode → More → "Second language" / "+ Translation") | phone, desktop | full, lite, manual | advanced | Overlay | ✕ Close |
| 14 | Second-language: messy-paste AlignmentEditor | `src/lyrics/SecondLanguagePanel.tsx:205` | menu (within surface 13, after pasting unstructured text — `align` phase) | phone, desktop | full, lite, manual | advanced | Overlay | onConfirm / onCancel (back to paste step) |
| 15 | Translation/ingest progress | `src/core/ui/ProgressOverlay.tsx:27` (used at `SecondLanguagePanel.tsx:184`, `UploadAudioFlow.tsx:369`, `LinkParser.tsx:288,295`) | auto (transient, during translation matching / decode / lyrics search) | phone, desktop | full, lite, manual | core | Overlay (transient, no exits — self-dismisses) | none |
| 16 | Replace-lyrics dialog | `src/player/PlayerView.tsx:1999` | menu (Edit mode → More → "Replace lyrics") | phone, desktop | full, lite, manual | core | Overlay | ✕ / backdrop; Replace / Keep after search completes |
| 17 | Tap-sync editor (tap-through) | `src/player/TapSyncEditor.tsx:97` | headline (Edit mode toolbar, no usable local audio) or menu (Edit mode → More, when local audio exists) | phone, desktop | full, lite, manual | core | Overlay | onComplete / onCancel |
| 18 | Offset-align screen | `src/player/OffsetAlignScreen.tsx:52` | precondition (via the "Line them up" banner, itself gated on lyric provenance) | phone, desktop | full, lite, manual | advanced | Overlay | onUseFullAlignment / onKeepTimings |
| 19 | Auto-align flow | `src/ai-pipeline/AutoAlignFlow.tsx:773` | headline (Edit mode confirm's "Continue") or auto (`autoAlignOnOpen` after Add-song, when lyrics arrive unsynced) | phone, desktop | **full, lite** — same gate as row 11; on manual the flow is unreachable | core | Overlay | ✕ (with running-work confirm) / Done |
| 20 | Generic loading overlay | `src/core/ui/LoadingOverlay.tsx:13` (used at `PlayerView.tsx:1672`, `:1674`, `:2107`) | auto (transient: lyrics loading, A/B-loop export, AI-tooling lazy-load) | phone, desktop | full, lite, manual | core | Overlay (transient, no exits — self-dismisses) | none |
| 21 | `DisplayMenu` panel (Lyrics display options) | `src/player/DisplayMenu.tsx:337` (desktop, `absolute z-50`) / `:349` (mobile, portalled `fixed z-50`); hook at `:278`; trigger at `PlayerView.tsx:1815` | menu (the "Display" / Aa trigger, in both journeys' default-viewport lists) | phone, desktop | full, lite, manual | core | **Overlay — anchored panel, no `fixed inset-0` root; missed by the spec's filter** | ✕ via Escape (hook), outside pointer press, or re-pressing the trigger |
| 22 | Edit-mode "More" menu | `src/lyrics/EditMode.tsx:649` (`role="menu"`); hook at `:377`; scrim at `:648` | menu (Edit mode toolbar → More) | phone, desktop | full, lite, manual | core | **Overlay — anchored menu; only its scrim was in the 15** | Escape, scrim click, or choosing an item; doorway to rows 12, 13, 16, 17 |
| 23 | Generic confirm dialog | `src/core/ui/ConfirmDialog.tsx:31` (`absolute inset-0 z-20`); hook at `:26`; 11 call sites (`LibraryScreen.tsx:169`, `SettingsView.tsx:302`, `PlayerControls.tsx:973`, `AddSongSheet.tsx:172,183`, `TapSyncEditor.tsx:101`, `AutoAlignFlow.tsx:776,802,812`, `PlayerView.tsx:2012,2054`) | precondition (a destructive or interrupting action is attempted) | phone, desktop | full, lite, manual | core | **Overlay — `absolute`, scoped to its parent sheet, not the viewport** | Confirm / Cancel; Escape maps to cancel |
| 24 | Word-tap lookup popover | `src/lyrics/WordLookupPopover.tsx:118`; hook at `:28`; rendered from `LyricDisplay.tsx:728` | precondition (tap a word on the active line) | phone, desktop | full, lite, manual | advanced | **Overlay — anchored `fixed`, no `inset-0`** | ✕ / Escape / outside press |
| 25 | Line-timing popover | `src/lyrics/TimestampPopover.tsx:222`; hook at `:147`; opened from `EditMode.tsx:333`, `:480`, `:808` | menu (Edit mode → a line's timestamp button) | phone, desktop | full, lite, manual | advanced | **Overlay — `absolute z-20`** | Escape / outside press; Start / End / Whole line tabs |
| 26 | Translation-repair popover | `src/lyrics/TranslationRepairPopover.tsx:38`; hook at `:30`; rendered from `LyricDisplay.tsx:409` | precondition (a line has translation-repair candidates) | phone, desktop | full, lite, manual | advanced | **Overlay — `absolute z-20`** | ✕ / Escape; choosing a candidate |
| 27 | "Repeats before next loop" menu | `src/player/PlayerControls.tsx:736` (portalled `fixed z-[60]`) | precondition (a loop playlist exists) then menu (the repeats chip) | phone, desktop | full, lite, manual | advanced | **Overlay — portalled, no `inset-0`; no `useModalDialog`** | outside `pointerdown` only (`:620`) — **no Escape** |
| 28 | "More playback options" menu | `src/player/PlayerControls.tsx:1237` (portalled `fixed z-[60]`) | menu ("More options" chip in the player toolbar) | phone, desktop | full, lite, manual | advanced | **Overlay — portalled, no `inset-0`; no `useModalDialog`** | outside `pointerdown` only (`:1193`) — **no Escape** |
| 29 | Mobile controls sheet (Saved loops / loop / speed) | `src/player/PlayerControls.tsx:1412` (`MobileControlsSheet`, backdrop at `:1409`); opened from the "Saved" chip at `:1759` | menu ("Saved loops" entry point in the default player viewport) | phone, desktop | full, lite, manual | advanced | **Overlay — its backdrop was registered as a scrim, the panel itself was not** | backdrop, drag handle, hand-rolled Escape (`:1399`) |
| 30 | Drag-retime strip (`retimeLine`) | `src/player/DragRetimeStrip.tsx:58`, rendered at `src/player/PlayerView.tsx:1745`; state at `:755`, latch at `:756`, waveform gate reads it at `:829` | precondition (Play mode, playback possible, and an anchor target is suggested or latched for the active line) | phone, desktop | full, lite, manual | advanced | **Inline — no dialog role, no `fixed inset-0`; not seen live** | Commit (`onCommit`) or the target clearing itself (`setRetimingLine(null)`) |

Rows 6, 7, 8, 9 are the non-`fixed inset-0` findings called out in Step 2 (buckets 3 and
4); rows 21–30 are bucket 5, found only by the corrected sweep. The registry therefore
holds **30 surfaces**, not 20 — the ten added rows are the material correction in this
revision, and Phase 3's `Overlay` union membership should be taken from 30. Rows 15 and 20 are generic, multi-site components; "seen live" for them is genuinely
ambiguous — both plausibly fired transiently during each journey's fetch/decode step (the
journeys explicitly exercised lyrics search and, in Journey B, audio decode/ingest), but
neither trace table recorded them as a discrete row, since they self-dismiss with no user
interaction. They are filed under bucket 2 rather than bucket 1 on that basis: not
*confirmed* seen, only "found statically." The one exception within row 20 is the
"Loading AI…" variant (`PlayerView.tsx:2107`), which is confirmed **not** to have fired in
either journey, since it is the `Suspense` fallback for `AutoAlignFlow` (row 19), which
itself never opened.

**Note:** Rows 15 and 20 are each registered as a single row keyed to the component's
definition line, with all call sites listed in the File:line column; if Phase 3's
`Overlay` union wants one variant per call site rather than one generic variant per
component, the table will need further splitting.

Two scrims are excluded from the 30-surface count (per the spec's own classification),
listed here for completeness since they were part of the Step-1 grep. Note that the
second one is a scrim *belonging to* registry row 29, not a surface in its own right —
the original sweep registered the backdrop and missed the panel behind it:

| Scrim | File:line | Purpose |
|---|---|---|
| More-menu click-catcher | `src/lyrics/EditMode.tsx:648` | `aria-hidden`, closes the lyric-row "More" menu on outside click |
| Sheet backdrop | `src/player/PlayerControls.tsx:1409` | shared `Sheet` component's backdrop (e.g. Saved-loops panel) |

### Reconciliation with the spec's draft `Overlay` union

Two members of the spec's draft union (`docs/superpowers/specs/2026-09-05-ui-finalization-design.md`,
§Design 1) did not line up with what measurement found. Both are now corrected in the
spec; recorded here so the disagreement and its resolution are on the record.

- **`{ kind: 'retimeLine'; lineIndex: number }` had no registry row.** The state is real
  — `retimingLine` at `src/player/PlayerView.tsx:755`, feeding `anchorTargetActive` at
  `:756`, which the waveform-decode effect reads at `:829` — but the surface it drives,
  `DragRetimeStrip`, has neither a dialog role nor a `fixed inset-0` root, so no sweep in
  the original method could have found it. It is now **row 30**. Note for Phase 3: as
  built it is *inline in Play mode*, not a layer over it, so modelling it as an `Overlay`
  is a deliberate change of shape rather than a transcription of today's code. That is
  defensible — it owns the waveform need, which is exactly what `screenNeeds` is for —
  but it should be a decision, not an assumption.
- **`{ kind: 'songMissing' }` is not an overlay.** Registry row 9 classifies it "Base —
  early `return`", and measurement supports that: `src/player/PlayerView.tsx:1647` returns
  *instead of* the player rather than layering over it, so there is no base mode
  underneath to return to. The spec's draft union placed it under `Overlay`; the audit's
  classification is the measured one and the spec has been corrected to match. This is
  the same shape as the documented August critical, which is why it matters that the two
  documents agree.

## Baseline numbers

| Journey | Device / tier | Decisions to player-with-timed-lyrics | Surfaces met | Controls in player (excl. lyric rows) |
|---|---|---|---|---|
| A | phone, Manual | 5 | 7 | 13 |
| B | desktop, Full | 4 | 6 | 14 |

The column is named "**decisions to player-with-timed-lyrics**", not "to first synced
playback", because playback was never observed — see the endpoint caveat in each journey.
The measured endpoint is "player open, lyrics present and timed, transport rendered", and
the column name now says so rather than promising a milestone the run did not reach. That
caveat stands in full; only the label is corrected.

"Decisions to player-with-timed-lyrics" is the **decision-points** count from each journey's
Numbers table (choices among ≥2 options, or input supplied), not the required-interactions
count — the brief's wording matches "decisions," and the two journeys' own sections already
flag interactions as the wider, contestable number (9 for A, 7 for B) for anyone who wants
it. "Surfaces met" follows the counting rule stated under Journey A's Numbers, which both
journeys now obey. "Controls in player" is the non-lyric-row count from each journey's default-viewport
listing. These five numbers are re-measured after Phase 5 per the spec's success criterion
5, and reported honestly including if a number did not move.

## Draft demote/cut table

Applying the criterion — *a surface earns default visibility only if the median user needs
it to reach "the lyrics follow the music and I can study them"* — to all 30 registry rows
plus the two landing-page duplicates first: **most of the registry already complies.**
Most Bucket 2/3/4 surfaces (rows 6–20) carry `reach` of `menu` or `precondition` outright.
Six of them — rows 6, 11, 15, 17, 19 and 20 — carry `auto` or `headline` in the registry,
but each one's `auto`/`headline` value is itself conditioned on a stated precondition, not
reachable on the unconditional default path:

- **Row 6** (Lyrics-found confirm) — `auto`, but fires only inline, once a match needs
  confirming.
- **Row 11** (Auto-align confirm) — `headline`, but appears only when
  `hasLocalAudio && autoAlignSupported`.
- **Row 15** (Translation/ingest progress) — `auto`, but only transient, during translation
  matching, decode, or lyrics search, and self-dismisses with no exits.
- **Row 17** (Tap-sync editor) — `headline` only when no usable local audio exists;
  otherwise it is `menu`.
- **Row 19** (Auto-align flow) — `headline` on the Edit-mode confirm's Continue, or `auto`
  only when `autoAlignOnOpen` fires after Add-song with lyrics arriving unsynced — and
  gated on device tier ≠ manual either way.
- **Row 20** (Generic loading overlay) — `auto`, but only transient (lyrics loading, A/B-loop
  export, AI-tooling lazy-load) and self-dismisses with no exits.

None of the six sits unconditionally in the default view, so none is a demote candidate.
The remaining Bucket 2/3/4 rows — Settings (10), Fix word pairing (12), the
second-language panel (13), **its messy-paste `AlignmentEditor` phase (14)**,
Replace-lyrics (16), and Offset-align (18) — are already gated behind a menu, a
precondition, or both. Row 14 is doubly gated: it is reachable only from inside row 13,
and only after unstructured text has been pasted. `Lyrics display
options` (the `DisplayMenu` trigger, present in both journeys' default-viewport lists) is
itself the entry icon for an already-correct one-level-down menu — it is the affordance,
not clutter, and is not a candidate.

**The ten rows added by the corrected sweep (21–30) are checked against the same
criterion and none is a demote candidate.** Rows 21, 22, 25, 27, 28 and 29 carry `menu`
outright; rows 23, 24, 26 and 30 carry `precondition` and appear only when they can act,
which is the criterion's preferred disposition already satisfied. Two are worth a second
look in Phase 5 rather than a row here, because they are judgment calls the evidence does
not settle: **row 30** (the drag-retime strip) inserts itself into Play mode on a
*suggested* anchor target the user did not ask for, which is the closest thing in the new
rows to unconditional default-surface presence; and **row 29** is the sheet behind the
existing row 2 of the table below, so any decision on that entry point is really a
decision about this sheet. Neither is added to the ranked table — the table's three rows
stand as reviewed.

That leaves a short list, drawn only from what actually
sits in the default viewport or fires unconditionally today:

### Loop-playlist hypothesis — measured, and REFUTED

Placed here, immediately before the table, because this is where both of its consumers
are: row 2 below, and the rationale above. (It was previously duplicated — once as a
"verdict" after the table and once as a measurement filed under `## Defects observed`,
where it did not belong, since it is not a defect.)

The spec hypothesised that "a visible share of `PlayerControls`' 35 buttons is
loop-playlist machinery (Saved loops, Rename, Move up, Move down, Remove, Plays before
next loop) living on the surface a beginner meets".

Measured on both journeys: **exactly one** of those six controls is in the default player
viewport — the "Saved loops" entry point (`PlayerControls.tsx:1759`). Opening it with no
loops saved reveals the mobile controls sheet (registry row 29) showing only a Close
button and the empty state "Set A and B, then tap Save to add loops here."
Rename / Move up / Move down / Remove / Plays before next loop (registry row 27)
**do not exist** for a first-time user; they render per-loop, so they are already gated
behind the precondition of having created a loop.

The machinery is therefore already correctly disclosed. Only the single entry point is a
candidate for Phase 5, and it is a weak one — carried into row 2 of the table below as
the lowest-confidence row in it.

Ranked by how much default-surface noise the change removes (per the brief's ranking
rule), highest first:

| Rank | Surface | Current reach | Proposed reach | Evidence | Risk if demoted |
|---|---|---|---|---|---|
| 1 | Landing page: 2 of 3 CTAs ("Get started →" and "Open the app" are identical to "Open the app →" in effect) | `auto` (first visit), all 3 wired to the same action — Journey A & B trace row 1, D2 | Cut the 2 redundant buttons; keep 1 | Journey A trace row 1 and Journey B trace row 1 both record "Three CTAs, all the same action" / "3 identical CTAs"; D2 names this explicitly. No feature is lost — the 3 buttons are one action, so this is a true cut, not a demotion, and carries none of the "nothing reaches it" ambiguity the spec worries about for other cuts. | None identified — a/b-style redundant-CTA testing is a possible reason not to, but nothing in this audit's evidence supports keeping 3. |
| 2 | Saved loops entry point (`PlayerControls.tsx`, "Saved loops" / "Open saved loops" icon) | `auto` — in the default player viewport on both journeys (Journey A's 13-control list, Journey B's 14-control list) | One level down — fold the entry point into an overflow ("More") affordance alongside the other loop-playlist controls it currently sits apart from | Loop-playlist measurement immediately above ("Loop-playlist hypothesis — measured, and REFUTED"): only this one of the six named loop controls is in the default viewport, and opening it with no loops saved shows only a Close button and an empty-state hint. The audit's own text already flags it: "Only the single entry point is a candidate for Phase 5, and it is a weak one." | A returning user who loops sections while studying (the feature's actual use case) loses a one-tap entry point and gains a menu hop. Weak evidence either way — this removes only one control, and is the lowest-confidence row in the table, carried over verbatim from the earlier measurement rather than strengthened by new evidence. |
| 3 | "+ Audio file" / "Add audio file" button, Manual tier only | `auto` — in Journey A's default-viewport control list | Judgment call, not a firm proposal: precondition-gate it away for Manual tier specifically | D1 records that this button's own copy promises "AI auto-align" and "unlocks AI align & export" on a tier that can deliver neither (`src/ai-pipeline/capability.ts` gate). That is a copy defect (D1), not this row — this row is the separate, narrower question of whether the *control's presence* on Manual tier serves the reach criterion at all, independent of its wording. | **Real risk of being wrong:** row 17 (Tap-sync editor) is not tier-gated in the registry, so a Manual-tier user may still want to attach local audio purely for tap-through timing, which needs no AI. Hiding the button on Manual tier could remove a legitimate need this audit did not directly test. Flagged as a judgment call precisely because the evidence is weaker than rows 1–2 — the user should treat this as "worth checking," not "worth cutting." |

**Not included, deliberately.** The onboarding carousel (3 steps, `auto` on first visit) and
the filename-ambiguity / lyrics-found-confirm inline surfaces were considered and excluded:
onboarding is already a one-tap-skip, first-visit-only precondition, and the two inline
surfaces are already precondition-gated on a mismatch/filename-derivation state that
genuinely needs resolving. No row is manufactured for them because there is no evidence they
violate the criterion — consistent with the spec's expectation that this list stays short,
possibly shorter than 3 rows if the user disagrees with row 3.

**D1 is explicitly excluded from this table.** The tier-blind AI copy (three sites, Manual
tier) is a correctness/honesty defect — the copy is wrong regardless of where the control
sits — not a reach question, and fixing it does not require moving or hiding anything. It
should be fixed on its own terms in whatever phase handles defects, independent of whatever
the user decides about row 3 above.

## Defects observed

Recorded, not fixed, per the standing rule for this phase.

### D1 — Tier-blind AI copy, three places (Manual tier)

The app promises AI capability to a device that can never deliver it. All three were
observed on this run, at `tier: "manual"`:

1. Add-song sheet, **Upload audio** tile — lists "✓ AI auto-align lyrics" under INCLUDES.
2. Add-song sheet, **YouTube link** tile — offers "+ Add audio file (unlocks AI align & export — optional)".
3. Player — status line reads "YouTube stream · add audio for AI align", beside a "+ Audio" button.

On Manual tier, attaching audio unlocks neither auto-align nor (per the same tile's own
LIMITATIONS list) clip export. The tier is known at render time via `getDeviceTier()`,
so this copy is conditionable. Note the YouTube tile is simultaneously *honest* in its
LIMITATIONS ("No AI auto-align or clip export") and *misleading* in its call to action —
the two lines contradict each other on the same screen.

Severity note for Phase 5: this is the single most repeated defect found in Journey A,
and it lands on the phone tier, which the spec treats as one of two primary audiences.

### D2 — Three identical landing CTAs (minor)

The landing page renders "Get started →", "Open the app →" and "Open the app". All three
call the same action. Not harmful; noted because the spec's simplification criterion
targets exactly this kind of redundant default-surface choice.

## Not defects — verified false positives

Recorded so later rounds do not re-file them.

- **Playback does not start.** Hidden-tab + synthetic-gesture artifact; see the Journey A
  endpoint caveat. The iframe is present and correctly configured.
- **`computer` clicks time out after 30s.** The Browser pane is hidden, so actions that
  wait for a paint cannot complete. Drive the app with `element.click()` from
  `javascript_tool` instead. **This artifact stalled two delegated attempts at this task
  before the cause was identified** — an agent retrying timing-out clicks looks exactly
  like "no progress for 600s". Anyone re-running this journey must know it up front.
- **Word-pair colouring at 0% / missing furigana.** Enrichment runs on
  `requestIdleCallback`, which is suspended in a hidden tab.

