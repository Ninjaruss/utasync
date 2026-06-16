# Unified Flow, In-Place Editing, and Multi-Source (YouTube + Spotify) — Design

**Date:** 2026-06-16
**Status:** Approved for planning
**Topic:** Clean up the app flow to prioritize ease of use and make existing aligned lines editable in place; unify YouTube/Spotify/Upload into one source resolver.

## Problem

Today the app scatters work across disconnected screens and front-loads every decision:

- **Editing is all-or-nothing.** A single mistimed line means re-tapping the entire song. Lyric text and original↔translation pairings can't be changed after import (the pairing editor appears only once, during bilingual import).
- **Alignment lives in three disconnected destinations** (`TapSyncEditor`, `AutoAlignFlow`, `AlignmentEditor`) plus a buried "✨ Re-align lyrics" link that restarts everything.
- **Home and Player feel like two apps.** Three home tabs (YouTube/Upload/My Songs) and the player share no navigation spine.
- **Sources are siloed.** A song is "a YouTube thing" or "an upload"; there's no metadata cross-fill, and Spotify isn't supported.

## Goals

1. **Ease of use first, precision optional.** The common action (fix one line's timing) is one tap; precise controls (drag-to-time, ±nudge, end-time) are revealed only when needed.
2. **No screen-switching, no menu-digging.** Editing happens inside the player; alignment tools are in-screen actions, not destinations.
3. **One navigation spine:** `Library ⇄ Song`, with Add and Settings as sheets.
4. **Interweave sources** via a resolver: Spotify supplies clean metadata/art, YouTube supplies free + AI-alignable playback, lrclib supplies pre-timed lyrics; each covers the others' gaps with a reliable manual fallback.

### Non-goals (v1)

- Auto-searching YouTube from a Spotify track (deferred; manual "pick the video" is the v1 path).
- Any backend service. Spotify uses client-side OAuth PKCE.
- Per-word re-timing in the editor (line-level only).
- Desktop-specific multi-pane layouts (mobile-first, responsive).

## Approach (chosen)

**"Player IS the editor"** (Approach A from brainstorming). The Song screen has a `Play ⇄ Edit` toggle in its top bar. Edit mode turns each lyric line into an editable row; Tap-through and Auto-align become tools *inside* this screen that return their results to the same view. Sources are unified behind a resolver so adding a song is one sheet regardless of provider.

---

## Architecture

### Navigation spine

```
Library (home)  ⇄  Song (Play ⇄ Edit)
   + Add a song  → sheet (Link / Upload / Spotify toggle)
   ⚙ Settings    → sheet
```

- **Library** replaces the 3-tab `HomeScreen` as the app's home base: a list of saved songs, each with album art, title/artist, and a sync badge (`synced` / `needs sync`). A prominent **＋ Add a song** button.
- **Add sheet**: a single bottom sheet with a source toggle (🔗 Link · ⬆ Upload · ♫ Spotify). Link accepts YouTube (and, when connected, Spotify) URLs. Fetches metadata + lyrics via the resolver, then opens the Song screen.
- **Song screen**: the unified player/editor. `← Library` always returns home.
- **Settings**: a sheet over the current screen (no navigation away). Reachable from Library and Song.

This collapses today's `home | player | settings` view-state and the three alignment screens into two screens + two sheets.

### Components

| Component | Role | Source of today's code |
|---|---|---|
| `LibraryScreen` | Home: song list + Add button + sync badges | new; absorbs `HomeScreen` + `SongLibrary` |
| `AddSongSheet` | One sheet, source toggle, resolver entry | new; absorbs `LinkParser` + `UploadAudioFlow` |
| `SongScreen` | Play ⇄ Edit container, transport, display chips | refactor of `PlayerView` |
| `PlayMode` | Read-only scrolling lyrics (today's `LyricDisplay`) | `LyricDisplay` (mostly unchanged) |
| `EditMode` | Editable line rows + in-screen alignment tools | new; absorbs `TapSyncEditor` + `AlignmentEditor` |
| `LineEditor` | Per-line expand: text, timing, row actions | new |
| `SettingsSheet` | Settings as a sheet | refactor of `SettingsView` |
| `sourceResolver` | Resolve a song across providers (metadata/playback/lyrics) | new; orchestrates `youtube.ts`, `lrclib.ts`, new `spotify.ts` |
| `spotify.ts` | PKCE auth, search, metadata, optional Web Playback | new |

`App.tsx` view state becomes `library | song` with `addSheetOpen` / `settingsSheetOpen` booleans, instead of `home | player | settings`.

---

## Feature: Edit mode (the heart)

In Edit mode the lyric list renders as rows. The design principle is **ease-first, precision-optional**.

### The simple path (default, one tap)
- While audio plays, the row matching the playhead is highlighted.
- **Tapping a line sets its start time to the current audio position** ("stamp at playhead") — no expansion needed. This is the single most common fix and works on *any* line, not just sequentially.

### The precision path (revealed on expand)
Tapping a line's **text** (or an expand affordance) opens `LineEditor` inline (audio keeps playing):
- **Original** and **Translation** text fields (this absorbs the old `AlignmentEditor` pairing flow — pairings are now editable anytime).
- **Set start @ playhead** button (explicit version of the tap action) + **drag-to-time** handle to scrub the start time visually.
- **±0.1s** (and ±0.5s) nudge buttons; optional **end-time** control.
- Row actions: **⊕ add line** (above/below), **🗑 delete**, **⋮⋮ reorder** (drag), and **merge/split** with adjacent lines.
- Untimed lines show a `—` timestamp and an `untimed` marker so gaps are obvious.

### In-screen alignment tools
A tools row at the bottom of Edit mode (not separate screens):
- **⏱ Tap-through** — the sequential tapper (today's `TapSyncEditor` logic) for a brand-new song; on finish it **returns to Edit mode** with rows populated, rather than terminating to a "Save & Practice" dead end.
- **✨ Auto-align** — runs `AutoAlignFlow`; results land back in Edit mode for review/tweak. **Shown only when the active playback provider has audio** (YouTube/upload); hidden with a short note ("AI align needs a YouTube or uploaded audio source") for Spotify-only songs.

### Persistence
Edits write through to `db.songs.put` (debounced) and re-run `enrichLines` for changed lines so furigana/romaji/tokens stay current. A song with all lines timed is `synced`; any untimed line marks it `needs sync` in the Library badge.

---

## Feature: Source resolver

A **Song** is an identity with three fillable facets — **metadata**, **playback**, **lyrics** — that any provider can fill, cross-checking the others.

### Provider capabilities

| Provider | Playback | AI-alignable audio | Metadata | Account |
|---|---|---|---|---|
| YouTube | ✓ free | ✓ | parsed from title | none |
| Upload | ✓ | ✓ | ID3 / filename | none |
| Spotify | ✓ Premium only | ✗ (DRM) | ✓ canonical + art | OAuth PKCE |
| lrclib | — | — | — (lyrics, often pre-timed) | none |

### Resolve flow (on Add)
1. User provides a YouTube/Spotify link or uploads a file. The resolver reads that provider's metadata.
2. **Cross-fill:** a YouTube import enriches its parsed title via Spotify (when connected) for clean artist/title/album/art; a Spotify track looks for a matching YouTube video (manual pick in v1) to use as **free, AI-alignable playback**.
3. With clean metadata, fetch **pre-timed lyrics from lrclib** (`findLyrics`). Many songs arrive already synced.
4. Open the Song screen. Auto-align offered when an audio-bearing provider exists; else Tap-through.

### Fallback (no silent guessing)
When a Spotify→YouTube match is not confident, or metadata is ambiguous, the resolver surfaces a short **"pick the right video"** candidate list or an **"upload the audio"** option. The user stays in control; every song can be made playable and editable.

### Spotify integration (v1)
- **Auth:** OAuth **PKCE**, fully client-side (no secret, no backend). A one-time **"Connect Spotify"** action (in the Add sheet and Settings).
- **Use:** search + canonical metadata/art for any song; **optional** direct Premium playback via the Web Playback SDK for users who want it.
- **Default playback for Spotify tracks** is the matched YouTube/upload (free, enables Auto-align). Direct Spotify playback is opt-in and disables Auto-align for that song.

---

## Data model changes

Additive and migration-friendly. Current `Song` keeps `sourceUrl` / `audioStoredPath`; we add a unified source list and derive from the legacy fields when absent.

```ts
type ProviderType = 'youtube' | 'spotify' | 'upload'

interface SourceRef {
  provider: ProviderType
  ref: string          // youtube videoId | spotify trackId | OPFS path
  url?: string
  hasAudio: boolean    // true for youtube/upload → AI-alignable
}

interface Song {
  // ...existing fields...
  sources?: SourceRef[]            // unified providers (forward model)
  activeProvider?: ProviderType    // which source plays now
  spotifyTrackId?: string
  albumArtUrl?: string
  syncState?: 'synced' | 'needs-sync'  // derived; drives Library badge
}
```

- **Dexie migration v2:** map legacy `sourceUrl` → a `youtube` `SourceRef`, `audioStoredPath` → an `upload` `SourceRef`; backfill `syncState` from whether every line has a `startTime`. Add an index on `syncState` for the Library badge query. Legacy fields remain readable; no destructive change.
- `LyricsData.alignmentMode` stays; Spotify-only songs are constrained to `manual`.

---

## Error handling

- **Spotify auth failure / not Premium:** Connect step explains Premium is needed for *direct* playback only; metadata/search still work; playback falls back to matched YouTube/upload.
- **No lyric match from lrclib:** open Edit mode with an empty/pasted-lyrics state and Tap-through ready.
- **Spotify→YouTube match low confidence:** show candidate picker; never auto-commit.
- **Missing/unreadable audio file (existing case):** controls stay inert (current behavior preserved).
- **Auto-align on a Spotify-only song:** button hidden with an explanatory note; Tap-through offered instead.

## Testing

- **Unit:** resolver cross-fill (YouTube→Spotify enrich, Spotify→YouTube match scoring by artist+title+duration), Dexie v2 migration (legacy → `sources`, `syncState` backfill), `LineEditor` edits (stamp-at-playhead, nudge, add/delete/merge/split), edit→persist round-trip.
- **Integration:** Add sheet resolve flow per provider; Edit-mode stamp updates timing and re-enriches; Tap-through returns to Edit mode with rows populated.
- **Manual/preview:** Play↔Edit toggle, drag-to-time, Library sync badges, Settings-as-sheet, Spotify connect (PKCE) happy path.
- Reuse existing alignment benchmark fixtures to guard MAE after the editor refactor.

---

## Phased implementation

The vision is coherent but large; implement in two phases so the flow/editing win ships first.

- **Phase 1 — Flow + in-place editing (the core ask):** Library spine, Add sheet (Link/Upload), Settings-as-sheet, `SongScreen` with Play⇄Edit, `LineEditor` (ease-first + precision), Tap-through/Auto-align folded in as in-screen tools, sync badges. Data model `sources`/`syncState` + Dexie v2. No Spotify yet (YouTube + Upload + lrclib carry Phase 1).
- **Phase 2 — Multi-source resolver + Spotify:** `sourceResolver`, `spotify.ts` (PKCE auth, search, metadata/art, optional Premium playback), cross-fill, Spotify→YouTube manual pick, Spotify source in the Add sheet, Auto-align gating for Spotify-only songs.

Each phase gets its own implementation plan.
