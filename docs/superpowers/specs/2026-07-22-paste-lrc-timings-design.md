# Paste LRC Timings — Design

**Date:** 2026-07-22
**Goal:** When a user pastes lyrics that already carry `[mm:ss.xx]` timestamps
(a timed LRC), use those times as the song's alignment instead of throwing them
away and re-deriving timing with Whisper. This makes a song align perfectly with
zero manual actions and zero transcription — sidestepping the transcribe-then-
match failures that mis-time dense/bilingual songs (e.g. Recollect).

**Decisions (user-confirmed):**
- Approach: **dedicated fast path** — detect timestamps at paste, build the
  alignment directly from the parsed times, skip Whisper entirely. Fall back to
  the normal transcribe-then-match path when no timestamps are present.
- Trust model: use the pasted times **as-is** (they are the user's ground truth).
  Acoustic re-polishing of an accurate LRC is out of scope (unproductive by the
  user's own assessment).
- Opt-in UX: **auto-use with a one-click escape hatch** — no modal, no setting.
- Scope: **Phase 1 only** (this spec). The separate "reference LRC → different
  recording of the same song" problem (studio LRC used to sync a FIRST TAKE
  performance) is explicitly deferred to its own brainstorm/spec — it is a real
  alignment problem, not a timestamp reuse, and needs its own design.

## Context — why this is small

The infrastructure already exists:

- `src/lyrics/lrc-parser.ts` → `parseLRC(lrc): TimedLine[]` is a complete parser
  (`[mm:ss.xx]` / `.xxx`, `[offset:±ms]`, `[ti/ar/al/...]` metadata; sorts by
  time; fills `endTime` from the next line's start).
- A song is treated as **"synced"** purely by virtue of its lines carrying real
  (non-zero) times — there is no separate `synced` flag on `Song`. Synced songs
  go straight to the library and **do not run `AutoAlignFlow`** (no transcription).
- The existing "found + synced" lyrics path already routes through `parseLRC`:
  `found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)`
  (`src/sources/UploadAudioFlow.tsx`).

So the pasted-LRC case is: **make the paste path choose `parseLRC` when the text
is timed, exactly as the "found + synced" path already does.** The non-zero times
then make the song synced automatically, which skips transcription automatically.

## Data flow

```
Paste text ──► hasLrcTimestamps(text) && !ignoreLrcTimings ?
                 │
    ┌────────────┴──────────────┐
   yes                          no
    │                           │
 parseLRC(text)           linesFromPlainText(text)   (strips stray tags — current cleaner)
 → lines WITH times       → lines at t=0 ("needs sync")
    │                           │
 synced song              AutoAlignFlow (Whisper transcribe-then-match)
 (skips transcription)
```

## Components

### 1. `hasLrcTimestamps(text: string): boolean` — new, pure

Location: `src/lyrics/lrc-parser.ts` (beside `parseLRC`, sharing its
`TIMESTAMP_RE` so detection and parsing can never disagree).

- Returns `true` when **≥ 2** lines begin with a valid `[mm:ss.xx]` time tag.
- The ≥2 threshold avoids false-triggering on a single stray bracket token in
  otherwise plain lyrics.
- Pure, deterministic, trivially unit-testable.

### 2. Paste routing — the branch

The three paste entry points share the `source === 'paste'` resolution shape:
- `src/lyrics/LyricsImportPanel.tsx` (`resolveManualLines`)
- `src/sources/UploadAudioFlow.tsx`
- `src/sources/LinkParser.tsx`

Change: when resolving a `paste` source, if `hasLrcTimestamps(pasted)` and the
per-paste `ignoreLrcTimings` override is not set, resolve via `parseLRC(pasted)`;
otherwise `linesFromPlainText(pasted)` as today. No explicit "synced" flag is
needed: a song is synced precisely because its lines carry real (non-zero) times,
so `parseLRC` output is synced for the same reason the "found + synced" path's
`parseLRC` output is. Confirm during implementation that the paste-source apply
path does not force `startTime` back to 0 anywhere between resolution and
`buildSong`.

**Robustness fallback:** if `hasLrcTimestamps` is true but `parseLRC` yields
**fewer** usable (non-empty-text) lines than `linesFromPlainText` would, fall
back to plain-text rather than emit a half-timed result. (Guards a malformed /
partially-timed paste.)

### 3. Opt-in UX — auto-use + escape hatch

On a timed paste, the panel resolves via `parseLRC` and renders a quiet,
dismissible note on the existing lyric-source confirmation surface
(`LyricsFoundConfirm` already renders a "time-synced / text-only" line — reuse
that pattern):

> ⏱ **Using your pasted timings** (N lines) · *Align from scratch instead*

- **"Align from scratch instead"** sets a per-paste `ignoreLrcTimings` flag →
  re-resolves via `linesFromPlainText` (strip + Whisper). One click, reversible.
- Editing the pasted text clears the override and re-runs detection, so the note
  always reflects the current box contents.
- The "N lines" figure doubles as honest feedback: a malformed paste that only
  detected 12 of 55 lines shows "12 lines", signalling the user to check.

## Interaction with the existing timestamp-stripping cleaner

The LRC-timestamp stripping added to `cleanPastedLyrics` (via
`stripLrcTimestamps`) is **not** superseded — it becomes the *"no / align from
scratch"* branch: it cleans stray tags when the user pastes plain lyrics or
explicitly overrides. Detection (`parseLRC`) and stripping never run on the same
path for the same paste; the branch chooses exactly one.

## Error handling / edge cases

- **No timestamps:** unchanged behavior (plain-text → Whisper).
- **Malformed / partial timing:** robustness fallback above → plain-text.
- **Line-count vs lyrics:** N/A for paste — the pasted text *is* both the lyrics
  and the timing source, so counts cannot diverge.
- **Blank timestamp-only lines** (`[01:19.92]` with no text): `parseLRC` already
  produces an empty-text line; these are dropped as non-lyric downstream (same
  as today's plain-text empties).
- **`[offset:±ms]`:** honored by `parseLRC` as-is.

## Testing

Offline-testable (pure), no browser needed for the core:

- `hasLrcTimestamps`: true on a ≥2-line timed LRC; false on plain lyrics, on a
  single stray bracket token, on empty text.
- Routing: a timed paste resolves to lines with the parsed times (synced); a
  plain paste resolves to t=0 lines (needs sync); an overridden timed paste
  resolves to t=0 lines.
- Robustness fallback: a mostly-plain paste with one stray `[..]` does not lose
  lines to `parseLRC`.
- End-to-end through the paste resolver: the Recollect LRC (55 lines) yields 55
  timed lines in order with the pasted times.

Browser-verified (manual, minimal): paste a timed LRC in Add-Song → confirm the
"Using your pasted timings" note, that the song lands synced (no align stage),
and that Play mode highlights on the pasted times; click "Align from scratch
instead" → confirm it falls back to the Whisper flow.

## Out of scope (this spec)

- Acoustic re-polishing / drift correction of pasted times.
- **Reference-LRC cross-recording alignment** (studio LRC → FIRST TAKE): distinct
  design, deferred to its own brainstorm. It is *not* timestamp reuse — the
  reference times are wrong for the target audio; only the lyrics + order are
  reusable, and lines must be re-distributed across the target's vocal-activity
  envelope. Tracked as the immediate next exploration.
