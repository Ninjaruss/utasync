# Utasync

**歌sync** — learn Japanese and English through music, with lyrics that follow the song in real time.

Utasync is an offline-first web app that turns YouTube links or your own audio files into a bilingual practice player. Paste a link, sync the lyrics, and study line by line with readings, translations, and tools built for language learners. All playback and AI processing runs in your browser — no account, no server, no subscription.

## What you can do

- **Build a song library** — add tracks from YouTube or upload local audio; metadata and lyrics are saved on your device.
- **Follow synced lyrics** — karaoke-style focus mode highlights the active line; tap any line to seek.
- **Study both languages** — Japanese lines show romaji and furigana; English lines can show IPA. Add a second-language translation and align it line by line or word by word.
- **Edit and align** — tap-to-sync timing, manual alignment tools, and optional auto-alignment powered by on-device speech recognition.
- **Practice harder sections** — A/B loop with crossfade, pitch-preserving speed control, and cloze mode to hide words as you listen.
- **Go deeper** — word-level alignment, grammar hints, and export to LRC or SRT for use elsewhere.

## How it works

1. **Add a song** from a YouTube URL (synced lyrics fetched when available) or by uploading an audio file.
2. **Open the player** — lyrics scroll with playback; switch display options for readings, translations, and word coloring.
3. **Refine timing** — use the tap editor or auto-align when you have local audio; attach lyrics or translations in edit mode.
4. **Practice** — loop a tricky verse, slow down without changing pitch, or run cloze drills on the active line.

Your library, audio files, and settings stay on your device (IndexedDB, OPFS, and localStorage). AI models for transcription and alignment download once and are cached for offline reuse.

## Free vs Pro

| | Free | Trial (2 songs) | Pro |
|---|---|---|---|
| YouTube playback + synced lyrics | ✓ | ✓ | ✓ |
| Tap-to-sync, readings, line seeking | ✓ | ✓ | ✓ |
| Local audio, speed control, A/B loop | | ✓ | ✓ |
| Auto-alignment, vocal separation | | ✓ | ✓ |
| Word alignment, cloze, export | | ✓ | ✓ |
| Unlimited songs | | | ✓ |

Trial songs keep Pro features permanently after you claim them.

## Getting started

To run Utasync locally or deploy it yourself, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for prerequisites, installation, and build instructions.

## Tech at a glance

React · Vite · Tailwind CSS · Zustand · Howler.js · Transformers.js (Whisper) · kuromoji · PWA

Design and phase specs live under [`docs/superpowers/`](docs/superpowers/).
