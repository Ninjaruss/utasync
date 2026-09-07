# UI inventory & baseline

**Date:** 2026-09-05
**Phase:** 1 of `docs/superpowers/specs/2026-09-05-ui-finalization-design.md`
**Status:** In progress

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

**Provenance nudge (in surface 5):** the player showed
"Lyrics not lining up? These timings came from a lyrics database. **Line them up**".
Another `precondition` reveal, keyed on lyric provenance. Not counted as a separate
surface — it gates nothing.

### Numbers

| Measure | Value |
|---|---|
| Decision points | **4** — enter app; dismiss onboarding; choose the audio file; verify title/artist |
| Required interactions | **7** — landing CTA, Next, Next, Done, ＋ Add a song, choose file, Add song |
| Distinct surfaces met | **5** |
| Controls in default player viewport | **17 total, 3 lyric rows, 14 non-lyric** |

The 14 non-lyric controls: ← Back, Play, Edit, Settings, Line them up, Lyrics display
options, Seek, Rewind 5 seconds, Start playback, Forward 5 seconds, Volume, Loop
(Tap to set), Speed (Normal 1x), Open saved loops.

**Journey B is shorter than Journey A** (4 decisions vs 5, 5 surfaces vs 7) because the
Upload tab is the default and the stubbed lyrics matched the filename-derived metadata
exactly, so no mismatch confirmation was needed. Journey A's extra steps are the source
switch and the mismatch guard.

### Endpoint caveat

As in Journey A, playback could not be confirmed — hidden tab, no trusted user gesture.
Measured to "player open, lyrics present and timed, transport rendered".

## Consolidated surface list

### Step 1 — static re-derivation

```
grep -rn "fixed inset-0" src --include='*.tsx'
```

returned **15 sites** — matches the spec's expected count exactly, no drift to record.
13 are user-facing surfaces; 2 are scrims, confirmed at the exact lines the spec named:

- `src/lyrics/EditMode.tsx:648` — `aria-hidden` click-catcher that closes the lyric-row
  "More" menu on outside click.
- `src/player/PlayerControls.tsx:1409` — backdrop `<button>` of the shared `Sheet`
  component (used by, e.g., the Saved-loops panel).

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

The excluded case: the **"Line them up" provenance nudge** (inline banner in
`PlayerView.tsx`, ~line 1783, seen live in Journey B) is *not* given its own row below.
The existing Journey B section already states explicitly why: "Not counted as a separate
surface — it gates nothing." Its own action button (**Line them up**) is what opens a real
surface, `OffsetAlignScreen` (row 19 below) — the banner itself is decoration on the
Player, not a screen.

### Step 3 — registry

`reach` ∈ `auto | headline | menu | precondition`. `devices` ⊆ `phone, desktop` — every
surface below is reachable on both device classes; none is device-gated (some are gated
on AI-*capability tier*, which is noted in Exits/notes, not the same axis as device
class).

| # | Surface | File:line | reach | devices | role | Base or overlay | Exits |
|---|---|---|---|---|---|---|---|
| 1 | Landing | `src/landing/LandingScreen.tsx` (routed `App.tsx:156`) | auto (first visit only) | phone, desktop | core | Base | 3 identical CTAs → Library |
| 2 | Library | `src/sources/LibraryScreen.tsx` (routed `App.tsx:167`) | auto (default/returning route) | phone, desktop | core | Base | ＋ Add a song, ⚙ Settings, open a song |
| 3 | Player (song view) | `src/player/PlayerView.tsx` (routed `App.tsx:159`) | headline (open a song) | phone, desktop | core | Base | ← Back |
| 4 | Onboarding carousel | `src/core/ui/Onboarding.tsx:56` | auto (first visit, over Library) | phone, desktop | core | Overlay | Skip / Back / Done |
| 5 | Add-song sheet | `src/sources/AddSongSheet.tsx:154` | headline (＋ Add a song) | phone, desktop | core | Overlay | ✕ Close; Add song (commit) |
| 6 | Lyrics-found confirm (mismatch) | `src/lyrics/LyricsFoundConfirm.tsx` (inline; used from `LinkParser.tsx:397`, `UploadAudioFlow.tsx:475`, `LyricsImportPanel.tsx:186`) | auto (inline in Add-song sheet, once a match needs confirming) | phone, desktop | core | **Inline — not `fixed inset-0`** | "Yes, this is the right song" / "Use different lyrics" — gates the sheet's commit |
| 7 | Filename-ambiguity helper | inline in `src/sources/AddSongSheet.tsx` (Upload tab) | precondition (title/artist derived from filename) | phone, desktop | advanced | **Inline — not `fixed inset-0`** | "Swap title and artist" (non-gating) |
| 8 | Edit mode (lyrics editor) | `src/lyrics/EditMode.tsx`, switched at `src/player/PlayerView.tsx:1879` | menu (Play/Edit toggle in Player header) | phone, desktop | core | **Base — inline mode-swap, no `fixed inset-0` root; not seen live** | Toggle back to Play |
| 9 | Song-not-in-library | `src/player/PlayerView.tsx:1647` (early `return`) | precondition (deep link to a songId not in local storage) | phone, desktop | core | **Base — early `return`, no `fixed inset-0` root; not seen live** | "Back to library" |
| 10 | Settings sheet | `src/settings/SettingsSheet.tsx:19` | menu (⚙ Settings, present on Library and Player) | phone, desktop | core | Overlay | ✕ / backdrop close |
| 11 | Auto-align confirm | `src/lyrics/EditMode.tsx:837` | headline (Edit mode's "Auto-align" button; only when `hasLocalAudio && autoAlignSupported`) | phone, desktop | core | Overlay | Cancel / Continue |
| 12 | Fix word pairing (AlignmentEditor from Edit mode) | `src/lyrics/EditMode.tsx:861` | menu (Edit mode → More → "Fix word pairing"; only when `hasSecondLang`) | phone, desktop | advanced | Overlay | onConfirm / onCancel |
| 13 | Second-language panel | `src/lyrics/SecondLanguagePanel.tsx:246` | menu (Edit mode → More → "Second language" / "+ Translation") | phone, desktop | advanced | Overlay | ✕ Close |
| 14 | Second-language: messy-paste AlignmentEditor | `src/lyrics/SecondLanguagePanel.tsx:205` | menu (within surface 13, after pasting unstructured text — `align` phase) | phone, desktop | advanced | Overlay | onConfirm / onCancel (back to paste step) |
| 15 | Translation/ingest progress | `src/core/ui/ProgressOverlay.tsx:27` (used at `SecondLanguagePanel.tsx:184`, `UploadAudioFlow.tsx:369`, `LinkParser.tsx:288,295`) | auto (transient, during translation matching / decode / lyrics search) | phone, desktop | core | Overlay (transient, no exits — self-dismisses) | none |
| 16 | Replace-lyrics dialog | `src/player/PlayerView.tsx:1999` | menu (Edit mode → More → "Replace lyrics") | phone, desktop | core | Overlay | ✕ / backdrop; Replace / Keep after search completes |
| 17 | Tap-sync editor (tap-through) | `src/player/TapSyncEditor.tsx:97` | headline (Edit mode toolbar, no usable local audio) or menu (Edit mode → More, when local audio exists) | phone, desktop | core | Overlay | onComplete / onCancel |
| 18 | Offset-align screen | `src/player/OffsetAlignScreen.tsx:52` | precondition (via the "Line them up" banner, itself gated on lyric provenance) | phone, desktop | advanced | Overlay | onUseFullAlignment / onKeepTimings |
| 19 | Auto-align flow | `src/ai-pipeline/AutoAlignFlow.tsx:773` | headline (Edit mode confirm's "Continue") or auto (`autoAlignOnOpen` after Add-song, when lyrics arrive unsynced) | phone, desktop (gated on device tier ≠ manual) | core | Overlay | ✕ (with running-work confirm) / Done |
| 20 | Generic loading overlay | `src/core/ui/LoadingOverlay.tsx:13` (used at `PlayerView.tsx:1672`, `:1676`, `:2107`) | auto (transient: lyrics loading, A/B-loop export, AI-tooling lazy-load) | phone, desktop | core | Overlay (transient, no exits — self-dismisses) | none |

Rows 6, 7, 8, 9 are the non-`fixed inset-0` findings called out in Step 2 (buckets 3 and
4). Rows 15 and 20 are generic, multi-site components; "seen live" for them is genuinely
ambiguous — both plausibly fired transiently during each journey's fetch/decode step (the
journeys explicitly exercised lyrics search and, in Journey B, audio decode/ingest), but
neither trace table recorded them as a discrete row, since they self-dismiss with no user
interaction. They are filed under bucket 2 rather than bucket 1 on that basis: not
*confirmed* seen, only "found statically." The one exception within row 20 is the
"Loading AI…" variant (`PlayerView.tsx:2107`), which is confirmed **not** to have fired in
either journey, since it is the `Suspense` fallback for `AutoAlignFlow` (row 19), which
itself never opened.

Two scrims are excluded from the 20-surface count (per the spec's own classification),
listed here for completeness since they were part of the Step-1 grep:

| Scrim | File:line | Purpose |
|---|---|---|
| More-menu click-catcher | `src/lyrics/EditMode.tsx:648` | `aria-hidden`, closes the lyric-row "More" menu on outside click |
| Sheet backdrop | `src/player/PlayerControls.tsx:1409` | shared `Sheet` component's backdrop (e.g. Saved-loops panel) |

## Baseline numbers

(Reserved for a later task in this phase.)

## Draft demote/cut table

(Reserved for a later task in this phase.)

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

### Measured: the spec's loop-playlist hypothesis is REFUTED for the first-run surface

The spec hypothesised that "a visible share of `PlayerControls`' 35 buttons is
loop-playlist machinery (Saved loops, Rename, Move up, Move down, Remove, Plays before
next loop) living on the surface a beginner meets".

Measured on both journeys: **exactly one** of those six controls is in the default player
viewport — the "Saved loops" entry point. Opening it with no loops saved reveals only a
Close button and the empty state "Set A and B, then tap Save to add loops here."
Rename / Move up / Move down / Remove / Plays before next loop **do not exist** for a
first-time user; they render per-loop, so they are already gated behind the precondition
of having created a loop.

The machinery is therefore already correctly disclosed. Only the single entry point is a
candidate for Phase 5, and it is a weak one.

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

