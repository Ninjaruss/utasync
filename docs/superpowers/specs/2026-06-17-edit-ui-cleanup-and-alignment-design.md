# Edit-page UI cleanup, streamlined A/B & speed, smarter second-language alignment

Date: 2026-06-17

## Problem

Two related sets of issues raised after the previous feature round:

1. **The edit page has too many buttons and risks accidental actions.** Edit
   mode shows ~20 live controls at once (play-mode display toggles, full
   transport, A/B loop, speed slider, re-align, footer actions, per-line
   controls), most irrelevant to editing text/timing. Several actions are
   single-tap and irreversible (delete line, Tap-through/Auto-align replacing
   all timing).
2. **A/B loop and speed controls are clunky in Play mode.** A/B requires a
   long-press (undiscoverable) to arm line-selection; the speed slider is
   always fully expanded, competing for space with transport controls.
3. **Auto-align silently fails for YouTube-only songs** (no `audioStoredPath`
   to decode), despite the UI implying it works for any audio source.
4. **Second-language pairing is fragile.** Pasted/found translations often
   include non-lyric header lines (`[Chorus]`, `Verse 2`) and don't always
   map 1:1 to the primary lines (one language merges two lines into one),
   causing frequent, full-song manual realignment in `AlignmentEditor`.

## Goals / Non-goals

**Goals:** declutter Edit mode and gate destructive actions behind
confirmation; streamline A/B and speed in Play mode; fix the YouTube
Auto-align dead end at the source (optional audio attach); reduce false
mismatches and shrink the manual-fix surface for second-language pairing.

**Non-goals:** no changes to the Whisper/Demucs alignment algorithm itself
(`AutoAlignFlow`'s internals), no changes to `AlignmentEditor`'s per-row UI,
no removal of the manual-tier tap-sync fallback (still the only timing path
for devices that can't run on-device AI).

---

## 1. Edit mode — hide non-editing chrome

`PlayerView.tsx`: when `mode === 'edit'`, hide the Furigana/Translation/
Side-by-side toggle row entirely (play-mode-only concerns), and replace the
full transport block (seek bar + speed slider + ⏮⏸▶⏭ + A/B loop + Re-align)
with a compact transport: play/pause button + seek bar only. Speed, A/B
loop, and Re-align disappear until the user switches back to the Play tab.
The compact transport stays because the timestamp popover (§5) needs a way
to play/pause/scrub while timing lines.

## 2. Line rows — inline edit-in-place, `LineEditor` removed

`EditMode.tsx` line rows no longer expand into a separate `LineEditor`
panel (`src/lyrics/LineEditor.tsx` is deleted).

- **Collapsed row:** timestamp pill + original text + translation text (if
  present), single tappable row.
- **Tapping text** turns `original`/`translation` into inline `<input>`s in
  place (original focused first). Blur/Enter commits via the existing
  `setText` logic (moved inline into `EditMode.tsx`).
- **While an input is focused**, small `⊕` (add line after) and `🗑`
  (delete line) icons appear at the row's end; they disappear once focus
  leaves. `nudgeStart` (±0.1 buttons) is removed — superseded by §5.

## 3. Footer regrouped, Tap-through removed

`EditMode.tsx` footer splits into two labeled groups:

- **Timing:** Auto-align only (or the existing "needs audio" hint when
  `!hasAudio`). The manual **Tap-through** button is removed.
- **Content:** Add line, 2nd language.

`chooseAutoAlignment` / `manualAlignMode` / `TapSyncEditor` and the
automatic manual-tier routing (`getDeviceTier() === 'manual'`) are
**unchanged** — confirmed in `AutoAlignFlow.tsx` (line ~123) that
manual-tier devices cannot run on-device AI at all, so this is a capability
fallback, not a redundant manual option. Capable-device users never see
tap-sync; manual-tier users are still auto-routed into it on load.

**`hasAudio` gating fix:** `EditMode`'s `hasAudio` prop currently means
"any active source has audio" (true for YouTube), but `AutoAlignFlow` only
works with `song.audioStoredPath` (a locally decodable file). Rename the
prop's meaning to "locally stored audio is available" — `PlayerView` passes
`!!song?.audioStoredPath` instead of `sources.some(s => s.hasAudio)`. The
disabled-state hint text updates to reflect that uploaded/attached audio is
required, not just an active source.

## 4. Destructive-action confirmation

- **Auto-align:** tapping shows a confirm dialog ("This replaces timing for
  all N lines. Continue?" / Cancel / Continue), styled like `UpgradeModal`
  (`bg-cinnabar-900` card), before launching `AutoAlignFlow`.
- **Delete line:** two-tap arm/confirm on the `🗑` icon — first tap turns it
  into a distinct "confirm delete" state, second tap within ~3s deletes;
  auto-resets to the normal state if the window passes without a second tap.

## 5. Timestamp pill becomes a popover

Tapping a line's timestamp pill no longer instantly stamps the playhead.
It opens a small popover anchored to the row containing:
- A horizontal scrub strip — drag to set the time directly.
- A "Use current ▶ {playhead time}" shortcut button (replaces the old
  tap-to-stamp behavior).

Closing the popover (tap outside / Done) commits whichever value was last
set. This closes the original "tapping a lyric overwrites its timing"
report at the root — no control in Edit mode stamps a value without an
explicit, deliberate action inside the popover.

## 6. Play mode — A/B loop streamlined

`PlayerView.tsx`: replace `useLongPress` on the A/B buttons with a plain
`onClick`.

- **Tap A or B** → always arms it (`armAB('a' | 'b')`), button pulses, hint
  text shows ("Tap a lyric line to set A/B" — unchanged copy).
- **Tap a lyric line** (`LyricDisplay`'s existing `onLineClick` routing) →
  `setABLoop({ [armingAB]: line.startTime })`, which already clears
  `armingAB` (`PlayerStore.setABLoop`, unchanged).
- **Cancel arming:** tapping the already-armed button again calls
  `armAB(null)`. Additionally, a click handler on the screen's outer
  container clears `armingAB` for any click that isn't itself a line
  selection — clicking back/settings/transport/anywhere else while armed
  cancels it. (A line click already clears `armingAB` via `setABLoop`
  before the bubbled container handler runs, so the extra clear there is a
  harmless no-op in that case.)
- `useLongPress` in `PlayerView.tsx` is deleted (no remaining callers).

## 7. Play mode — Speed slider collapsible

`PlayerView.tsx`: replace the always-expanded speed row with a compact
chip showing "Speed: 100%" (or "🔒 Speed control" for non-Pro, unchanged
gating). Tapping the chip expands the full slider inline; tapping again
collapses it. Manual toggle only, no auto-collapse timer.

## 8. YouTube Auto-align: optional audio attach at creation

`LinkParser.tsx` gains an optional step: "Attach audio for instant
auto-sync" (a file input, same pattern as `UploadAudioFlow`'s file picker).
If provided, `ingestAudioFile(file)` runs and the resulting
`audioStoredPath` is included in `buildSong`'s input alongside the YouTube
`sourceUrl` — `PlayerView` already prefers locally stored audio for
playback when both exist (`isYouTube = !!ytVideoId && !song?.audioStoredPath`,
unchanged), and `AutoAlignFlow` now has real audio to decode. Skipping this
step still produces a fully prefilled song (title/artist/lyrics/
translation); Auto-align in `EditMode` simply shows the "needs audio" hint
per §3 instead of silently failing, and the user falls back to whatever
`manualAlignMode(getDeviceTier())` already routes to.

## 9. Second-language pairing: header stripping + stanza-block alignment

`src/lyrics/bilingual.ts`:

**Header/annotation stripping.** Add `stripNonLyricLines(lines: string[]):
string[]`, filtering lines matching common non-lyric patterns before
counting/pairing: `^\[.*\]$`, `^\(.*\)$`, and bare section labels (`Verse
\d*`, `Chorus`, `Bridge`, `Intro`, `Outro`, `Hook`, case-insensitive,
optionally trailing punctuation/numbers). Applied to `extractSecondLanguageLines`'s
output before pairing. (Primary `TimedLine[]` text is never run through
this — it's already real sung lines by the time pairing happens.)

**Stanza-block alignment.** Replace `attachSecondLanguage`'s flat
index-zip with block-scoped pairing:

1. **Primary blocks:** if `primary` lines are timed (`linesAreTimed`,
   reused from `alignmentPolicy.ts`), split into blocks wherever the gap to
   the next line's `startTime` exceeds a threshold (e.g. 2.5× the song's
   median line gap, or a flat 4s minimum — exact constant decided during
   implementation/testing). If primary isn't timed yet, treat the whole
   song as one block (today's behavior).
2. **Secondary blocks:** split the raw secondary text on blank lines
   *before* flattening — `extractSecondLanguageLines` gains a sibling
   `extractSecondLanguageBlocks(secondary: string): string[][]` that
   preserves blank-line-delimited groups (each group run through
   `stripNonLyricLines`).
3. **Pairing:** zip primary blocks with secondary blocks by order. Within
   each matched block pair: if line counts match, pair by index
   (high-confidence, no review needed). If they don't match *within that
   block*, only that block's lines are flagged for manual fix.
4. **`needsAlignment` becomes block-scoped:** `AttachResult` gains
   `mismatchedBlocks: number[]` (indices into the block list) instead of a
   single song-wide boolean. `SecondLanguagePanel`/`LinkParser` route to
   `AlignmentEditor` pre-filled with only the mismatched blocks' lines
   (correctly-paired blocks are merged back in untouched), instead of
   dumping the entire song into manual review.

This doesn't attempt to auto-resolve within-block mismatches (still
genuinely ambiguous — line/word counts aren't a reliable cross-language
signal) but sharply reduces both false-positive full-song mismatches
(via header stripping) and the size of what needs manual cleanup when a
real mismatch occurs (via block scoping).

---

## Files touched

- `src/lyrics/EditMode.tsx` — inline edit-in-place (2), footer regroup +
  Tap-through removal (3), `hasAudio` semantics (3), confirm dialogs (4),
  timestamp popover (5).
- `src/lyrics/LineEditor.tsx` — **deleted** (2).
- `src/lyrics/lineOps.ts` — `nudgeStart` removed if no longer called (2).
- `src/lyrics/bilingual.ts` — `stripNonLyricLines`,
  `extractSecondLanguageBlocks`, block-scoped `attachSecondLanguage` (9).
- `src/lyrics/SecondLanguagePanel.tsx` — consume block-scoped
  `AttachResult` (9).
- `src/sources/LinkParser.tsx` — optional audio-attach step (8), consume
  block-scoped `AttachResult` (9).
- `src/sources/UploadAudioFlow.tsx` — consume block-scoped `AttachResult`
  if it also calls `attachSecondLanguage` (9, verify during implementation).
- `src/player/PlayerView.tsx` — mode-scoped chrome (1), tap-to-arm A/B (6),
  collapsible speed chip (7), `hasAudio` prop fix (3).
- `src/player/PlayerStore.ts` — no changes (existing `armingAB`/`armAB`/
  `setABLoop` already support tap-to-arm as-is).
- `src/ai-pipeline/AutoAlignFlow.tsx` — no changes (consumes
  `audioStoredPath` as it already does).

## Testing

- `bilingual.test`: `stripNonLyricLines` (brackets, parens, section labels,
  leaves real lyrics alone), `extractSecondLanguageBlocks` (blank-line
  grouping), block-scoped `attachSecondLanguage` (matching blocks paired
  cleanly, single mismatched block flagged without disturbing others,
  untimed-primary fallback to single block).
- `EditMode.test`: inline edit commits text, add/delete icons appear only
  while editing, delete requires two taps, footer shows only Auto-align in
  Timing group, Auto-align triggers confirm dialog, timestamp pill opens
  popover (no longer stamps directly), `hasAudio` hint reflects
  `audioStoredPath` not just an active source.
- `PlayerView.test` (or wherever transport is currently tested): A/B tap
  arms instead of long-press, second tap on armed button cancels, outside
  click cancels, line click sets armed endpoint; speed chip
  expands/collapses; Edit mode hides display toggles/full transport.
- `LinkParser.test`: optional audio attach produces `audioStoredPath` on
  the built song; skipping it still produces a complete song.

## Risks / edge cases

- **Stanza-gap threshold tuning** — too low splits real same-section lines
  into separate blocks (harmless: still pairs 1:1 by order across the
  split, just finer-grained); too high merges genuinely separate stanzas
  into one block (only matters if that merged block also has a count
  mismatch). Exact constant validated against real song timing during
  implementation rather than guessed here.
- **Untimed primary at first import** — block alignment degrades to
  today's single-block behavior; no regression, just no improvement for
  that one moment (lines become timed shortly after via alignment, and any
  later second-language attach/replace gets full block treatment).
- **Outside-click-cancels-arming** could fire from the line click itself
  bubbling up — already handled by `setABLoop` clearing `armingAB`
  synchronously before the container handler reads it, so the bubbled
  call is a no-op, not a race.
