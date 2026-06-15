# Local Audio Upload + AI Auto-Align — Design Specification

**Date:** 2026-06-15
**Status:** Approved (pending spec review)
**Related:** `2026-06-15-utasync-design.md` (master product spec)

---

## Problem

The AI auto-align pipeline (`src/ai-pipeline/`) is fully implemented but **orphaned**: `AutoAlignFlow` is never imported or mounted, so nothing reaches it and the bundler tree-shakes it (and `@xenova/transformers`) out entirely. The supporting hooks exist — `Song.alignmentMode` supports `'auto'`, `SettingsView` has a "Clear AI model cache" button — but there is no UI entry point.

`AutoAlignFlow` requires raw audio: it reads `song.audioStoredPath`, decodes the file, and feeds PCM samples to the Whisper worker. The app today is **YouTube-link only** — `saveAudio()` is never called, no song ever has `audioStoredPath`, and there is no file-upload UI. A bare "Auto-align" button would therefore always fail with "No audio file found."

This feature adds the missing prerequisite (a local audio ingest path) and exposes auto-align on songs that have stored audio.

## Goals

- Let a user upload a local audio file, attach lyrics (LRCLIB lookup, pasted text, or a subtitle file), and create a playable song.
- When no lyrics are found automatically, actively prompt for accurate text (paste or subtitle file) — auto-align matches audio to provided lyrics rather than transcribing from scratch, so good input text is what makes alignment accurate.
- **The end result is always a song with lyrics aligned to the audio**, regardless of whether the input lyrics had correct timing, no timing, or were raw text. Auto-align is the mechanism that guarantees this; on devices that can't run on-device AI, manual alignment provides the same guarantee.
- Expose AI auto-align in the player for songs that have stored audio on a capable device.
- Keep the existing YouTube flow untouched.
- Keep the initial bundle lean by lazy-loading the AI pipeline only when invoked.

## Non-goals (YAGNI)

- Drag-and-drop upload, waveform preview, audio format conversion (browser `decodeAudioData` handles common formats).
- Router/navigation rework (the app uses a 3-state `view` switch in `App.tsx`).
- Changing the auto-align algorithm or worker code.

---

## Architecture

### New files

- **`src/sources/songBuilder.ts`** — pure helpers:
  - `buildSong(input): Song` — assembles a `Song` with `createdAt`, `isTrialSong: false`, and the given title/artist/lines/`sourceUrl?`/`audioStoredPath?`/`alignmentMode`. Accepts an optional `id` (defaults to `uuidv4()`) so the upload path can reuse the id already chosen by `ingestAudioFile`.
  - `linesFromPlainText(text): TimedLine[]` — splits pasted lyrics on newlines, trims, drops blank lines, and maps each to an untimed line (`startTime: 0`, `endTime: 0`, `original: line`, `translation: ''`).
- **`src/lyrics/subtitle-parser.ts`** — `parseSubtitle(text: string, filename: string): TimedLine[]`. Dispatches on extension: `.lrc` → reuse existing `parseLRC`; `.srt` and `.vtt` → parse cue blocks (`HH:MM:SS,mmm`/`HH:MM:SS.mmm` ranges) into timed lines, stripping cue indices, `WEBVTT` headers, and inline tags. Multi-line cues collapse to one line's `original`. Unknown extensions fall back to `linesFromPlainText`.
- **`src/sources/audioIngest.ts`** — `ingestAudioFile(file: File): Promise<{ songId: string; audioStoredPath: string }>`: generates a `songId`, reads `file.arrayBuffer()`, calls `saveAudio(songId, buffer)`, returns `{ songId, audioStoredPath: audioStoragePath(songId) }`.
- **`src/sources/UploadAudioFlow.tsx`** — the upload UI. Ingests audio + lyric text, creates the song, and calls `onSongReady`. It does **not** run alignment itself — that is centralized in `PlayerView` (which owns the loaded audio). Props: `{ onSongReady: (songId: string) => void }`.
- **`src/sources/HomeScreen.tsx`** — two-option toggle ("YouTube link" / "Upload audio") rendering `LinkParser` or `UploadAudioFlow`; forwards `onSongReady`. Props: `{ onSongReady: (songId: string) => void }`.

### Changed files

- **`src/sources/LinkParser.tsx`** — replace inline `Song` assembly with `buildSong(...)`. No behavior change (still fetches LRCLIB, still routes count-mismatch through `AlignmentEditor`).
- **`src/App.tsx`** — `home` view renders `<HomeScreen onSongReady={...} />` instead of `<LinkParser>` directly.
- **`src/player/PlayerView.tsx`** — own the **alignment guarantee**: when a song has stored audio but untimed lyrics, route into auto-align (capable device) or `TapSyncEditor` (`manual` tier); also expose a manual "re-align" button. Wires `TapSyncEditor`'s `audioPosition` to the engine.
- **`src/player/TapSyncEditor.tsx`** — currently orphaned; wired in as the no-AI manual-timing fallback. Expected unchanged (it already returns `TimedLine[]` via `onComplete` and takes `audioPosition: () => number`).
- **`src/ai-pipeline/AutoAlignFlow.tsx`** — add a `default` export (keep the named export) so it can be lazy-loaded.

---

## Data flow

### Upload

`UploadAudioFlow` collects: an audio file (`<input type="file" accept="audio/*">`), `title`, and `artist`. Lyrics come from one of three sources, surfaced as a small segmented control: **"Find lyrics (LRCLIB)"** (default), **"Paste lyrics"**, **"Subtitle file"**.

Auto-align aligns audio to *provided* lyric text — it does not transcribe captions from scratch — so accurate lyric text is what makes alignment good. The flow therefore steers the user toward supplying text rather than ever proceeding with empty lines.

On submit:

1. `ingestAudioFile(file)` → stores audio in OPFS, returns `{ songId, audioStoredPath }`.
2. Lyrics resolution:
   - **LRCLIB mode** → `fetchLRCFromLRCLIB(title, artist)`. If a result is found → `parseLRC()`. **If nothing is found**, do not proceed empty: switch the UI into a fallback state that prompts the user to **paste lyrics** and/or **attach a subtitle file** (`.lrc`/`.srt`/`.vtt`), explaining that accurate text yields accurate auto-align.
   - **Paste mode** → `linesFromPlainText(pasted)` (untimed; auto-align fills timing).
   - **Subtitle mode** → read the file's text → `parseSubtitle(text, file.name)` (timed lines preserved from the subtitle).
3. `buildSong({ id: songId, title, artist, audioStoredPath, lines, alignmentMode: 'manual' })` → `db.songs.put(song)` → `onSongReady(song.id)`.

`UploadAudioFlow` stops at creating the song and opening the player. Ensuring the lyrics are actually aligned to the audio is `PlayerView`'s job (next section), because the manual-timing fallback (`TapSyncEditor`) needs the player's live audio position.

### Why incoming timing is safely superseded

`alignTranscriptToLines` consumes only each line's **text** (`original`/`translation`) and derives all `startTime`/`endTime` from the Whisper transcript and per-line word counts. Whatever timing arrived with the lyrics — none, partial, or wrong — is discarded when auto-align runs. So "the input had bad timing" is not a failure case: running auto-align is exactly how it gets fixed. `alignmentMode` stays `'manual'` until an auto-align run sets `'auto'`.

Note: `ingestAudioFile` generates the id, and `buildSong` must accept that id so the stored audio filename (`songs/${songId}.mp3`) and the song record agree. `buildSong`'s `id` is therefore an optional input that defaults to a fresh uuid when omitted (the YouTube path omits it).

The resulting song has `audioStoredPath` and no `sourceUrl`, so `PlayerView`'s existing `isYouTube = !!ytVideoId && !song?.audioStoredPath` is `false` → it uses the `AudioEngine` path (which now loads the stored file).

### Alignment guarantee (in PlayerView)

`PlayerView` is the single place that guarantees a stored-audio song ends up aligned. After the song loads, compute `linesAreTimed = lines.some(l => l.endTime > 0)`.

**Automatic ensure-alignment** — when `song.audioStoredPath` is set and `!linesAreTimed` (raw paste, or a subtitle/LRC with no usable timestamps), the player enters an alignment step before normal playback:
- **Capable device** (`getDeviceTier() !== 'manual'`) → mount `AutoAlignFlow` (lazy, see below). It decodes the stored audio, transcribes, aligns, and persists.
- **`manual` tier** (no WebGPU) → mount `TapSyncEditor` with `audioPosition={() => engine.position}` and the line text; the user taps along to the playing audio. Its `onComplete(lines)` persists the timed lines.

**Manual re-align (always available)** — a "✨ Re-align" affordance lets the user re-run alignment on demand even for already-timed songs (e.g. supplied timing was wrong): `AutoAlignFlow` on capable devices, `TapSyncEditor` on `manual` tier.

**Lazy AI load** — `AutoAlignFlow` is imported lazily so `@xenova/transformers` and the Whisper/Demucs worker chunks download only when alignment actually runs:

```ts
const AutoAlignFlow = lazy(() => import('../ai-pipeline/AutoAlignFlow'))
```

mounted inside `<Suspense fallback={…}>`. (`TapSyncEditor` is light and statically imported.)

**On completion** — both paths produce timed `TimedLine[]`, persist via `db.songs.put`, then `setSong(updated)`, push lines to the lyrics store, and re-run `enrichLines`. `AutoAlignFlow` sets `alignmentMode: 'auto'`; the tap-sync path leaves it `'manual'`.

---

## Error handling

- **Upload:** missing file/title → inline validation, submit disabled. `ingestAudioFile` failure (OPFS write) → inline error, no song created.
- **Lyrics lookup:** LRCLIB miss or network error → **do not** create an empty song. Surface the fallback prompt ("No lyrics found — paste them or attach a subtitle file so auto-align can match the audio accurately") and require paste or subtitle input before the song is created. A bad/unparseable subtitle file → inline error, keep the user in the fallback state.
- **Auto-align:** `AutoAlignFlow` already handles its own stages and error display (`setError`/`'error'` stage). If an AI run fails on a capable device, the song still has its (possibly untimed) lyric text and the user can retry or fall back to tap-sync — they are never left without lyrics.
- **Manual timing:** `TapSyncEditor` requires the audio to be playing; entering the tap-sync step starts playback so the user can tap in time. Partial/abandoned tap-sync keeps the prior lines (no destructive overwrite until `onComplete`).

---

## Testing

Unit tests (vitest, matching existing `tests/` style):

- `tests/sources/songBuilder.test.ts` — `buildSong` sets defaults and passes through fields; `linesFromPlainText` splits, trims, drops blanks, yields zero-timed lines.
- `tests/sources/audioIngest.test.ts` — `ingestAudioFile` calls `saveAudio` with the file bytes and returns a matching `audioStoredPath` (mock `../core/opfs/audio`).
- `tests/lyrics/subtitle-parser.test.ts` — `parseSubtitle` for `.srt` (comma ms, cue indices stripped), `.vtt` (dot ms, `WEBVTT` header stripped, inline tags removed), `.lrc` (delegates to `parseLRC`), and unknown extension (falls back to plain text). Verifies start/end times and multi-line cue collapsing.

UI components (`UploadAudioFlow`, `HomeScreen`, `PlayerView` alignment orchestration, `TapSyncEditor` wiring) stay thin over the tested helpers. If the "needs alignment" decision (`linesAreTimed` + tier → which path) grows beyond a trivial expression, extract it to a small pure helper and unit-test it directly.

Verification: full lint + typecheck + test run, plus a production build to confirm worker chunks now emit and `@xenova/transformers` lands in a **lazy** chunk (not the entry chunk).

---

## Risks / notes

- `saveAudio` stores every file as `${songId}.mp3` regardless of real format. This is only a filename; `decodeAudioData` and Howler (`format: ['mp3','m4a','ogg']`, `html5: true`) work off content/blob URL, so it is functionally fine. Left as-is to stay in scope.
- This is the first time the AI workers will actually build; the production-build verification step is the gate that confirms the toolchain emits them correctly under Vite 8 + Rolldown.
