# Utasync

**歌sync** — learn Japanese and English through music, with lyrics that follow the song in real time.

Utasync is an offline-first PWA that turns YouTube links or your own audio files into a bilingual practice player. Paste a link or upload a track, sync the lyrics, and study line by line with readings, translations, and tools built for language learners. Playback and AI processing run in your browser — no account, no backend server, no subscription.

> **🎤 Try it now → [utasync.app](https://utasync.app)**  
> The official hosted version is a fully offline PWA with one-click model downloads, automatic updates, and zero setup.  
> Your $9.99 one-time purchase directly supports continued development.

*Utasync is built and maintained by a solo developer. The one-time purchase funds ongoing improvements and keeps the app private, ad-free, and independent — forever.*

## What you can do

### Build your library

- **Add songs two ways** — upload a local audio file (recommended) or paste a YouTube URL for instant streaming playback.
- **Auto-fetch lyrics** — YouTube captions when available, then [LRCLIB](https://lrclib.net/) search; fall back to pasting text or importing LRC/SRT/VTT files.
- **Metadata autofill** — title and artist from file tags, filename heuristics, or YouTube oEmbed; album art when available.
- **Sync status at a glance** — each song shows **synced** or **needs sync** in the library.

### Follow and study lyrics

- **Focus-mode player** — karaoke-style layout: the active line is large and centered; tap any line to seek.
- **Japanese support** — tokenization, romaji, furigana (ruby), and grammar-pattern hints.
- **English support** — tokenization, IPA readings, and grammar hints.
- **Bilingual display** — show or hide translation; stacked or side-by-side layout.
- **Word-pair coloring** — on capable devices, embedding-based alignment colors matched words between languages (hover to highlight pairs).
- **Second language** — attach a translation in Edit mode via paste, smart line matching, or manual alignment.

### Edit and align timing

- **Play / Edit modes** — practice in Play; refine lyrics and timing in Edit.
- **Tap-to-sync** — stamp line starts while audio plays (YouTube or local).
- **Manual editing** — edit line text, add/delete lines, adjust timestamps per line.
- **Replace lyrics** — re-fetch from captions/LRCLIB or import a new file without re-adding the song.
- **AI auto-align** — on-device Whisper transcription with content-based lyric matching (local audio required). Full-tier devices optionally run vocal separation (Demucs) before transcription.
- **Attach local audio** — YouTube-only songs can add an audio file later to unlock auto-align and A/B export while keeping the same library entry.

### Practice harder sections

- **A/B loop** — set loop points by line tap or controls; crossfade at boundaries; configurable repeat count.
- **Loop playlists** — save multiple A/B segments per song and cycle through them with per-loop repeat presets.
- **Speed control** — pitch-preserving slowdown via SoundTouch (local audio; YouTube speed may be limited by the embed).
- **Cloze mode** — hide content words on the active line at easy / medium / hard difficulty.
- **A/B export** — download the loop region as audio, with optional SRT sidecar (local audio + timed lyrics).

### Export and manage storage

- **Export lyrics** — LRC or SRT from Settings or the player.
- **Storage dashboard** — see usage for songs, AI model cache, and orphaned uploads; clear cache or remove stale audio.
- **Everything stays local** — library metadata in IndexedDB (Dexie), audio in OPFS, settings in localStorage, AI models in Cache Storage.

## Two ways to add a song

| | **Upload audio** | **YouTube link** |
|---|---|---|
| Playback | Local file (offline-capable) | Streams via YouTube embed |
| Lyrics lookup | LRCLIB + paste / file import | YouTube captions → LRCLIB → paste / file |
| AI auto-align | ✓ (after upload) | After attaching a local audio file |
| A/B clip export | ✓ | After attaching a local audio file |
| Tap-to-sync & manual edit | ✓ | ✓ |
| Speed control | Full (SoundTouch) | Subject to YouTube embed limits |

Upload is the recommended path for serious study; YouTube is a quick way to start when you only have a video URL.

## How it works

1. **Add a song** from the library — choose upload or link, confirm metadata, and resolve lyrics.
2. **Open the player** — lyrics scroll with playback; use the display menu for readings, translation layout, and word coloring.
3. **Refine in Edit mode** — tap-sync timing, edit lines, add a second language, or run auto-align when local audio is available.
4. **Practice** — loop a verse (or a saved playlist of loops), slow down, run cloze drills, or export a clip to study offline elsewhere.

AI models (Whisper, text embeddings, optional Demucs) download once on first use and are cached in the browser. The app picks a **device tier** automatically:

| Tier | Requirements | AI capabilities |
|---|---|---|
| **Full** | WebGPU + 6 GB+ RAM | Vocal separation + Whisper + word alignment |
| **Lite** | WebGPU + 4 GB+ RAM | Whisper + word alignment (no separation) |
| **Manual** | Any modern browser | Tap-sync and manual tools only |

## Free vs Pro

Utasync is a one-time purchase (via LemonSqueezy) — no subscription.

> **Ready to unlock Pro?** [Buy once, keep forever →](https://utasync.app/pro)

| | Free | Trial (2 songs) | Pro |
|---|---|---|---|
| YouTube playback + synced lyrics | ✓ | ✓ | ✓ |
| Tap-to-sync, readings, line seeking | ✓ | ✓ | ✓ |
| Local audio, speed control, A/B loop | | ✓ | ✓ |
| Auto-alignment, vocal separation | | ✓ | ✓ |
| Word alignment, cloze, export | | ✓ | ✓ |
| Unlimited songs | | | ✓ |

Trial songs keep Pro features permanently after you claim them.

## For contributors & self-hosters

If you just want to use the app, visit **[utasync.app](https://utasync.app)** — no build required.  
The instructions below are for developers who want to run the code locally or contribute.

```bash
git clone https://github.com/Ninjaruss/utasync.git
cd utasync
npm install
cp -r node_modules/kuromoji/dict public/dict   # required for Japanese tokenization
npm run dev
```

Full prerequisites, optional Demucs model setup, build/deploy notes, browser support, and troubleshooting are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npx vitest run` | Run unit tests (jsdom) |

## Tech at a glance

| Layer | Stack |
|---|---|
| UI | React 19, Vite 8, Tailwind CSS 3 |
| State | Zustand (persisted settings) |
| Storage | Dexie (IndexedDB), OPFS (audio), Cache Storage (models) |
| Audio | Howler.js, Web Audio API, SoundTouchJS, AudioWorklet crossfade |
| AI | @xenova/transformers (Whisper), ONNX Runtime Web (Demucs), embedding workers |
| Japanese NLP | kuromoji, kuroshiro, wanakana |
| English NLP | compromise, CMUdict subset |
| Lyrics sources | YouTube captions, LRCLIB, LRC/SRT/VTT parsers |
| PWA | vite-plugin-pwa + Workbox |
| Licensing | jose (JWT verification), LemonSqueezy (placeholder) |
| Tests | Vitest, Testing Library |

## Project layout

```
src/
├── core/           # DB schema, OPFS, types, shared UI, idle scheduling
├── sources/        # Library, add-song flows, YouTube, LRCLIB, audio ingest
├── player/         # PlayerView, AudioEngine, A/B loop, controls, tap-sync
├── lyrics/         # Display, edit mode, parsers, export, bilingual tools
├── ai-pipeline/    # Whisper/Demucs workers, aligners, auto-align flow
├── language/       # Japanese & English tokenizers, phonetics, grammar, word colors
├── cloze/          # Cloze engine and overlay
├── payment/        # License verification, trial slots, upgrade modal
└── settings/       # Settings sheet and storage management
```

Design specs and phase plans live under [`docs/superpowers/`](docs/superpowers/).

## Support the project

If Utasync helps you learn a language, consider [buying a Pro license](https://utasync.app/pro) for $9.99.  
That one purchase unlocks unlimited auto-alignments and all future updates — and helps keep the project alive.

## License

Source code is released under the [MIT License](LICENSE). You may study, fork, and self-host the project freely.

The **Pro license** sold at [utasync.app](https://utasync.app) is a separate product purchase that unlocks premium features in the official app — it is not required to run the code locally for development or personal use.
