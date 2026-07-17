# UI Experience Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the approved cut-line from the 2026-07-16 UI audit — 1 P0 + 42 small P1s (Wave 1), then 15 medium/restructure P1s (Wave 2, mockup-gated) — bringing every journey stage to the public-launch bar on phones.

**Architecture:** Pure UI/copy/feedback changes grouped by surface so each task touches a disjoint file set. No alignment/AI logic changes. Wave 2 restructures are gated on companion-page mockup approval before any code. Cloze practice remains deferred (its own project); cloze findings are OUT of this plan.

**Tech Stack:** React 18 + Tailwind 3.4 + Vite; vitest + @testing-library/react for component tests.

**Ground truth for every item:** `docs/superpowers/audits/2026-07-16-ui-audit-inventory.md` carries per-finding evidence (file:line + current classes/strings). When this plan says "per inventory", that doc's evidence/fix entry is the exact spec.

**Commit discipline:** Commit after each task with the message given. NOTE: repo signs commits via 1Password SSH; if signing is still locked (`1Password: failed to fill whole buffer`), STOP at the first commit step, keep changes staged, and surface to the user — do not use `--no-gpg-sign`.

**Verification per task:** `npx tsc -p tsconfig.app.json --noEmit` + the task's named test files + `npx vitest run` at wave end must all pass. The corpus/alignment guards must stay byte-green: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/labelHonesty.corpus.test.ts`.

---

## Wave 1 — P0 + small P1s

### Task 1: Toast durations + Library data freshness

**Files:**
- Modify: `src/core/ui/Toast.tsx:16`
- Modify: `src/sources/LibraryScreen.tsx:17,21-23,64`
- Modify: `src/App.tsx` (delete callback plumbing), `src/settings/SettingsView.tsx` (invoke it)
- Test: `tests/lyrics/LibraryScreen.test.tsx` (create if absent — check `tests/` for existing library tests first)

- [ ] **Step 1: Failing tests.** (a) Toast: rendering a `warning` toast with a 110-char message keeps it mounted at t=4.5s (advance fake timers) and auto-dismisses `info` at 4s. (b) LibraryScreen: while the songs query is unresolved, the empty-state text ("Your library is empty") is NOT in the document; after resolving with 0 songs it appears. (c) After invoking the deleted-song callback, the ghost card is removed.

```tsx
// tests/lyrics/LibraryScreen.test.tsx (new) — shape:
it('does not flash the empty state while songs load', async () => {
  let resolve!: (s: Song[]) => void
  vi.spyOn(db.songs, 'orderBy').mockReturnValue({ reverse: () => ({ toArray: () => new Promise(r => { resolve = r }) }) } as never)
  render(<LibraryScreen onOpenSong={vi.fn()} onOpenSettings={vi.fn()} />)
  expect(screen.queryByText(/library is empty/i)).toBeNull()
  resolve([]); await screen.findByText(/library is empty/i)
})
```

- [ ] **Step 2: Run tests — expect FAIL** (`npx vitest run tests/lyrics/LibraryScreen.test.tsx tests/core/Toast.test.tsx` — create Toast test file mirroring existing test conventions if none exists).
- [ ] **Step 3: Implement.** Toast: `const duration = kind === 'info' ? 4000 : Math.max(8000, message.length * 60)` (errors/warnings ≥8s, scale by length). LibraryScreen: `useState<Song[] | null>(null)`; empty state renders only when `songs?.length === 0`; loading renders nothing (or a 2-row skeleton div with `animate-pulse`). Ghost cards: lift a `refreshSongs()` (re-run the dexie query) and call it from App when SettingsView reports a deletion (add `onSongDeleted?: () => void` prop chain App → SettingsSheet → SettingsView; SettingsView already deletes — call the callback after).
- [ ] **Step 4: Tests pass**; run `npx vitest run tests/lyrics/ tests/core/ 2>/dev/null` scoped as available.
- [ ] **Step 5: Commit** `fix(ui): honest toast timing + library loading/ghost-card freshness (audit W1)`

### Task 2: Safe-area insets (PWA standalone)

**Files:**
- Modify: `src/sources/LibraryScreen.tsx:42` (header container), `src/core/ui/Toast.tsx` (stack position), `src/settings/SettingsSheet.tsx:14-15` (scroll container bottom), `src/App.tsx:72` (banner wrapper)

- [ ] **Step 1:** Add `pt-[env(safe-area-inset-top)]` to the library header container and the fixed banner wrapper; toast stack `bottom` becomes `bottom-[max(1rem,env(safe-area-inset-bottom))]`; settings sheet scroll container gets `style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}`. Mirror the existing PlayerControls safe-area pattern (grep `safe-area` in src/player first and reuse its exact utility form).
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.app.json`; `npx vitest run tests/lyrics/EditMode.test.tsx tests/lyrics/LibraryScreen.test.tsx` (rendering unaffected).
- [ ] **Step 3: Commit** `fix(ui): respect PWA safe-area insets in library header, toasts, settings sheet, banners`

### Task 3: Add-song feedback traps (UploadAudioFlow + LinkParser + shared)

**Files:**
- Modify: `src/core/ui/useConfirmedClose.ts:12-15`, `src/sources/UploadAudioFlow.tsx`, `src/sources/LinkParser.tsx`, `src/core/ui/ProcessProgress.tsx`, `src/sources/coverArt.ts` + save path in UploadAudioFlow, `src/sources/addSongProgress.ts`, `src/sources/progressUtils.ts`, `src/lyrics/LyricsImportPanel.tsx`
- Test: existing add-song tests under `tests/sources/` (locate with `ls tests/sources`), extend.

Items (each per inventory evidence/fix):
1. **Dirty-close guard:** `useConfirmedClose` accepts `dirty` in addition to `busy`; both flows report `dirty = !!pasted.trim() || !!file || (metaLoaded && title.trim().length > 0)`; ConfirmDialog copy: "Discard this song? Your pasted lyrics will be lost."
2. **Search-again dead end:** add a "Search again" button to `skipSearchButtons` (sets lyric phase back to `'idle'`), both flows.
3. **Keystroke search storm:** debounce the idle→searching transition ~800ms after last title/artist edit (setTimeout + cleanup in the search effect; keep `searchGenRef`).
4. **Single-step progress honesty:** in ProcessProgress, when `steps.length === 1 && taskProgress == null`, hide the Overall bar + "1/1" counter; render the indeterminate shimmer + substep checklist + elapsed seconds.
5. **Cover-art stall:** route iTunes lookup through `fetchJson` with 5s timeout, fail-to-no-art; move `resolveCoverArt` after `setSaveProgress({phase:'saving-song'})` so the label matches.
6. **Jargon:** replace user-facing "LRCLIB" with "the lyrics database" (progressUtils, addSongProgress, UploadAudioFlow:288); "synced" → "time-synced", "plain" → "text-only". Keep one parenthetical "(via LRCLIB)" credit in LyricsFoundConfirm.
7. **Touch targets:** `manualTabClass` gets `min-h-11 touch-manipulation` in UploadAudioFlow, LinkParser, LyricsImportPanel.
8. **Contrast floor:** the "Skip search and add lyrics manually:" line and peers: `text-[10px] text-white/25` → `text-xs text-white/60`.

- [ ] **Step 1:** Failing test for the dirty-close guard (render flow, paste lyrics, fire backdrop close, expect ConfirmDialog text).
- [ ] **Step 2:** Implement all 8; run scoped tests + typecheck.
- [ ] **Step 3: Commit** `fix(ui): add-song trust pass — dirty-close guard, search-again, debounce, honest progress, copy/targets (audit W1)`

### Task 4: Align-wait trust (AutoAlignFlow small items)

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`
- Test: `tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` conventions; add `AutoAlignFlow.unload.test.tsx`

Items:
1. **beforeunload guard:** `useEffect` registering `beforeunload` (preventDefault + returnValue) while processing; removed on done/error/cancel.
2. **Visible crash-downgrade:** route the two retry notices ("Word-level pass failed…", "High-accuracy model failed…") through a `retryNotice` state that stays visible in the transcribing stage detail (instead of being wiped by `setProgress(0)`); on the high-accuracy fallback flip stage to `'loading'` so the fallback download shows.
3. **Demucs leak:** `'Demucs model not installed (see docs/DEPLOYMENT.md). Transcription will run on the full mix.'` → `"Vocal isolation isn't available right now — alignment will run on the full mix."`; keep the original as `console.warn`.
4. **Toggle copy:** "Word-level timestamps (slower) — More reliable furigana…" → "Accurate timing (slower) — better furigana and tighter line timing on long songs." (This is the single unified feature name — see Task 8.)

- [ ] **Step 1:** Failing test: mounting in processing state registers beforeunload (spy on addEventListener), unmount/done removes it.
- [ ] **Step 2:** Implement; scoped tests + typecheck.
- [ ] **Step 3: Commit** `fix(ui): align-wait trust — unload guard, visible fallback retries, de-jargoned copy (audit W1)`

### Task 5: Edit-mode small items + the P0 trap

**Files:**
- Modify: `src/lyrics/AlignmentEditor.tsx`, `src/lyrics/SecondLanguagePanel.tsx:121-131`, `src/lyrics/EditMode.tsx`
- Test: `tests/lyrics/EditMode.test.tsx`, new `tests/lyrics/AlignmentEditor.test.tsx`

Items:
1. **[P0] AlignmentEditor cancel:** add `onCancel` prop rendered as a 44px ✕ header button (copy the pattern at SecondLanguagePanel.tsx:139); SecondLanguagePanel wires it to close WITHOUT applying. Failing test first: rendering AlignmentEditor shows a button with `aria-label="Cancel"`; clicking calls onCancel and not onConfirm.
2. **Context copy:** under the AlignmentEditor heading add: "We couldn't automatically match every line — your paste had a different number of lines. Rows left blank just stay untranslated." Badge → "N lines without a translation".
3. **Control targets (S part):** ↑ ↓ ✕ buttons get `min-w-11 min-h-11` and `gap-1` (full mobile restack is Wave 2 Task 12).
4. **Guidance type floor:** all `text-[10px]` hint paragraphs in EditMode (lines ~446-513) and the TimestampPopover instruction line → `text-xs`, popover instruction `text-white/60`.
5. **Recover explainer:** pair the "Recover N sections" button with a `text-xs text-white/60` sentence: "N parts of the song couldn't be timed — re-scan just those parts. Your edits are kept."
6. **Emoji → SVG:** replace ⏱ ⊕ 🗑 with 16px inline `stroke="currentColor"` SVGs (clock/plus/trash) so tint classes work.

- [ ] **Step 1:** Failing AlignmentEditor cancel test.
- [ ] **Step 2:** Implement; run `npx vitest run tests/lyrics/`.
- [ ] **Step 3: Commit** `fix(ui): edit-mode pass — alignment-editor escape hatch (P0), guidance legibility, recover explainer, real icons (audit W1)`

### Task 6: Play-mode small items

**Files:**
- Modify: `src/lyrics/WordLookupPopover.tsx`, `src/player/PlayerControls.tsx`, `src/player/PlayEditToggle.tsx:17`, `src/player/DisplayMenu.tsx:108,225`, `src/player/TapSyncEditor.tsx:33-71`
- Test: `tests/lyrics/WordLookupPopover.test.tsx` + player tests under `tests/player/`

Items:
1. **Popover dismiss swallow:** capture-phase pointerdown closes AND suppresses the trailing click (one-shot `click` capture listener calling stopPropagation+preventDefault); add a ✕ close button in the card.
2. **Popover position:** set card `bottom` from the dock's measured top edge (CSS var set by PlayerControls via ref, fallback `bottom-24`).
3. **Seek bar:** wrapper `py-4 -my-2` (≥44px); thumb `opacity-100 md:opacity-0 md:group-hover:opacity-100`; add `role="slider"` + `aria-valuemin/max/now` + `aria-valuetext` (mm:ss).
4. **Emoji transport icons → SVG:** ⏮ ▶ ⏸ ⏭ 🔇 🔉 🔊 ⏩ ⋯ replaced with monochrome inline SVGs (or `︎` stopgap ONLY if an SVG breaks a test snapshot — prefer SVG).
5. **PlayEditToggle invisible track:** `bg-white/8` → `bg-white/[0.08]`, `bg-cinnabar-950/98` → `bg-cinnabar-950/95`.
6. **DisplayMenu translation discovery:** when `!hasTranslation`, keep the Translation section with hint row "No translation attached — add one in Edit mode" (+ button switching to Edit that opens SecondLanguagePanel if trivially wireable; otherwise hint only).
7. **Tap-sync instructions:** add "Play the song and tap when each line starts" above the button; `aria-label="Mark line start"`; finish button → "Save timing".

- [ ] **Step 1:** Failing test: pointerdown outside the popover does NOT trigger a lyric-row click (spy `onLineClick`).
- [ ] **Step 2:** Implement; scoped tests + typecheck.
- [ ] **Step 3: Commit** `fix(ui): play-mode pass — popover dismiss/position, seekbar ergonomics+a11y, themable icons, translation discovery, tap-sync copy (audit W1)`

### Task 7: Translation + Settings small items

**Files:**
- Modify: `src/lyrics/SecondLanguagePanel.tsx:98,106,136,203`, `src/settings/SettingsView.tsx`, `src/settings/SettingsSheet.tsx:14-15`
- Test: `tests/lyrics/SecondLanguagePanel.test.tsx`, settings tests if present

Items:
1. **Surplus lines silently dropped:** pass `extraLines: transLines.slice(lines.length)` in the catch branch (and stop hardcoding `[]` at :98/:106/:203) so AlignmentEditor's Extra-lines UI can appear.
2. **Invisible CTA:** empty-state "Paste lyrics" gets the accent style used by "Attach"; all secondary buttons in the panel → `bg-cinnabar-950 border border-cinnabar-800` + hover/active.
3. **Model-cache confirm:** inline confirm pattern (reuse song-row delete pattern): first tap swaps to "Models re-download next time you align (~{size}). Clear? [Cancel] [Clear]" using the size already computed in the storage breakdown.
4. **Link targets/contrast:** both storage action links get `min-h-11 flex items-center`, resting `text-white/60`.
5. **Vocal-sep jargon:** title "Isolate vocals for timing"; description "Improves lyric timing on songs with loud instrumentals. Downloads an extra AI model the next time a song is aligned."
6. **Sticky sheet header:** header row `sticky top-0 z-10 bg-cinnabar-950` inside the scroll container.
7. **LRC label:** button text → "Export"; widen cluster `gap-1` → `gap-2` (away from Delete).
8. **Copy cross-references:** toast "…Use \"Clean up orphaned audio\"…" → quote the real label "Remove orphaned audio".

- [ ] **Step 1:** Failing test: pasting N+3 translation lines surfaces 3 extra lines to AlignmentEditor (assert extraLines prop / rendered rows).
- [ ] **Step 2:** Implement; scoped tests + typecheck.
- [ ] **Step 3: Commit** `fix(ui): translation surplus lines + visible CTAs; settings confirm/labels/targets (audit W1)`

### Task 8: One-name copy unification + landing quick wins

**Files:**
- Modify: `src/player/PlayerView.tsx:1223`, `src/ai-pipeline/AutoAlignFlow.tsx` (checkbox label from Task 4), `src/lyrics/EditMode.tsx:459-496` (hint copy), `src/landing/LandingScreen.tsx:15,21,96-98`
- Test: `tests/lyrics/EditMode.alignmentHint.test.tsx` (update asserted strings)

Items:
1. **One feature, one name:** the accurate re-align is called **"Accurate timing"** everywhere: AutoAlignFlow checkbox (done in Task 4), Play banner ("Re-align with Accurate timing for tighter per-line sync (slower)"), both EditMode hints; "word-level timestamps" disappears from user copy. Also unify "Tap-through" ↔ "tap-sync" → the button label **"Tap-through"** is quoted verbatim wherever referenced.
2. **Landing jargon:** "across flipped SOV/SVO word order" → "even when Japanese and English put words in opposite order"; "alternate readings get adopted, uncertain ones flagged" → "furigana is checked against how the singer actually pronounces each word".
3. **Landing trust:** footer reassurance `text-white/25` → `text-white/45`; render `<LegalLinks className="mt-3" />` beneath it.

- [ ] **Step 1:** Update hint test expectations first (they will fail against current strings after rename — that's the failing test).
- [ ] **Step 2:** Implement; `npx vitest run tests/lyrics/EditMode.alignmentHint.test.tsx tests/lyrics/EditMode.test.tsx`.
- [ ] **Step 3: Commit** `fix(copy): one name for accurate re-align; landing de-jargon + legal links (audit W1)`

### Task 9: Wave 1 verification gate

- [ ] `npx tsc -p tsconfig.app.json --noEmit` clean.
- [ ] `npx vitest run` — full suite green (baseline 1,428 + new tests).
- [ ] `npx eslint src tests --max-warnings 0` on changed files (match repo lint norms; pre-existing warnings excluded).
- [ ] Corpus guards byte-green: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/labelHonesty.corpus.test.ts`.
- [ ] Companion before/after page for the user; user spot-checks on phone at :5173.

---

## Wave 2 — mockup-gated restructures & mediums

**Every task here starts with a companion mockup step; code only after the user approves that task's mockup.**

### Task 10: Play screen real estate (dock + notice slot) — the flagship

**Files:** `src/player/PlayerControls.tsx:1342-1466`, `src/player/PlayerView.tsx:1182-1243`, `src/player/WordColorProgressBanner.tsx`
**Findings:** collapsed dock ≈42% of 375×667 viewport; up to three strips stack above lyrics; inverted touch-target tiers (`compact` = 36px on phone).

- [ ] **Step 1: Mockup** (companion): current vs proposed — three collapsed panels (Loop/Speed/Saved) become one horizontal chip row opening a single shared bottom drawer; CompactVolume dropped on mobile (hardware buttons); the three in-flow strips become ONE notice slot with priority (audio-failed > accurate-timing > untimed > word-color progress, which shrinks to a chip in the Display toolbar). Target: ≥7 lyric lines visible on 375×667.
- [ ] **Step 2: User approves mockup.**
- [ ] **Step 3: Failing tests:** notice-slot priority (render with multiple notices → only highest priority visible); chip row opens drawer; compact chips have `min-h-11`.
- [ ] **Step 4: Implement** (also fixes the tier inversion: compact keeps small visuals via padding but `min-h-11` hit areas).
- [ ] **Step 5:** Full player test files green; commit `feat(ui): play-screen real estate — single notice slot, chip-row dock drawer, 44px targets (audit W2)`

### Task 11: Edit toolbar + timestamp reach + undo sync

**Files:** `src/lyrics/EditMode.tsx:398`, `src/lyrics/TimestampPopover.tsx:45-47`
- [ ] **Step 1: Mockup:** toolbar as one 44px row — Auto-align promoted primary, Undo/Redo as icon pair, Replace lyrics / Tap-through / 2nd language in a "More" overflow menu.
- [ ] **Step 2: User approves.**
- [ ] **Step 3: Failing tests:** overflow menu contains the three actions; TimestampPopover: nudge buttons (−0.5/−0.1/+0.1/+0.5s) adjust the draft, "Use current position" chip sets draft from the (already-plumbed) `playhead` prop, window re-centers when the thumb hits an edge; external `lines` prop change (simulated gap recovery) either clears or annotates the undo stack — assert Undo does NOT revert the external change silently.
- [ ] **Step 4: Implement.**
- [ ] **Step 5:** `npx vitest run tests/lyrics/` green; commit `feat(ui): edit toolbar hierarchy, timestamp nudges/current-position, undo external-change sync (audit W2)`

### Task 12: AlignmentEditor mobile restack

**Files:** `src/lyrics/AlignmentEditor.tsx:94-135`
- [ ] **Step 1: Mockup:** stacked per-pair cards at <sm (original full-width wrapping, translation input below, 44px controls right), current grid kept at ≥sm.
- [ ] **Step 2: User approves.** **Step 3:** failing test (narrow render shows wrapped original text, no `truncate` class). **Step 4:** implement. **Step 5:** commit `feat(ui): alignment editor readable mobile layout (audit W2)`

### Task 13: Banner flow + first-run consent + align errors

**Files:** `src/App.tsx:72`, `src/core/ui/OfflineBanner.tsx`, `UpdateBanner.tsx`, `src/ai-pipeline/AutoAlignFlow.tsx`, `src/ai-pipeline/workerError.ts`
- [ ] **Step 1: Mockup:** banners as normal-flow rows (App becomes `flex flex-col h-[100dvh]`, views `flex-1 min-h-0`); first-run consent gate card inside the align modal ("First song setup — downloads a ~240MB speech model once, then everything runs on your device. [Continue] [Not now]", persisted flag in SettingsStore).
- [ ] **Step 2: User approves.**
- [ ] **Step 3: Failing tests:** consent gate shows once (flag persisted) and Continue proceeds to loading; unclassified error surfaces friendly copy — add `classifyAlignError()` mapping network/fetch → "Couldn't download the speech model — check your connection and try again", OOM/wasm → existing memory copy, else "Something went wrong during auto-align. Your song is saved — try again from Edit mode." with the raw message in a collapsible details block.
- [ ] **Step 4: Implement** (includes the low-confidence done-state "Re-run with vocal isolation" one-tap CTA from the inventory guidance item).
- [ ] **Step 5:** commit `feat(ui): in-flow banners, first-run download consent, friendly align errors + re-run CTA (audit W2)`

### Task 14: Cohesion mediums — error color distinction + audio validation

**Files:** `tailwind.config.ts` (no palette change — component treatment), new `src/core/ui/InlineError.tsx`, error sites (SettingsView:215, UploadAudioFlow:422, LinkParser:418, AutoAlignFlow:596), `src/sources/UploadAudioFlow.tsx:86-107` (+`audioMetadata.ts` probe helper)
- [ ] **Step 1: Mockup:** InlineError treatment (filled `bg-red-900/90 border-red-700/50` + warning glyph, matching Toast) vs current accent-identical text; audio-validation inline warning.
- [ ] **Step 2: User approves.** **Step 3:** failing tests: InlineError renders glyph+role=alert; picking a non-decodable file shows "This file doesn't look like playable audio"; >100MB shows size warning. **Step 4:** implement (duration-probe via extracted metadata; `Audio` canplay fallback probe). **Step 5:** commit `feat(ui): distinct error treatment + audio-file validation (audit W2)`

### Task 15: Landing product mock

**Files:** `src/landing/LandingScreen.tsx`
- [ ] **Step 1: Mockup:** one static self-authored lyric line (invented Japanese, NOT from any real song) rendered with real app classes — ruby furigana + 2-3 color-paired word→translation chips — under the hero.
- [ ] **Step 2: User approves.** **Step 3-4:** implement (pure static JSX; no audio). **Step 5:** commit `feat(landing): show the product — static synced-lyric mock in hero (audit W2)`

### Task 16: Wave 2 verification gate + wrap

- [ ] Full suite + typecheck + corpus guards green.
- [ ] Companion before/after gallery; user phone spot-check.
- [ ] Update `docs/superpowers/audits/2026-07-16-ui-audit-inventory.md`: mark fixed items, note deferred P2s.
- [ ] Memory + findings doc updates; commits/PR (pending 1Password unlock).

---

## Explicitly out of scope (approved)
- Cloze/practice (all 5 findings) — deferred to its own project (Decision 2 = defer).
- All 47 P2 items except free adjacencies while editing the same lines.
- Alignment/AI behavior, theme replacement, new features.
