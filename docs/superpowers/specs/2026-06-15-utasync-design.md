# Utasync — Design Specification
**Date:** 2026-06-15
**Version:** 1.0
**Source spec:** Utasync Final Technical Specification v2.1

---

## Overview

Utasync (歌 + sync) is an offline-first PWA that turns any YouTube link or uploaded audio file into a bilingual language-learning practice tool. Primary pair: Japanese ↔ English. One-time purchase ($9.99) via LemonSqueezy. All processing is local — no server, no subscription.

---

## Visual Design

- **Layout:** Focus Mode (karaoke-style). Active line is large and centered. Japanese + romaji/IPA + translation stack on the active line. Adjacent lines are visible but dimmed.
- **Color theme:** Cinnabar — deep crimson-black base (`#0d0404` → `#180606`), soft red glow on active text (`text-shadow: 0 0 20px rgba(248,113,113,0.5)`), accent gradient `#dc2626 → #f87171`. Light mode uses inverted values with same accent.
- **Typography:** System UI stack; Japanese uses system CJK fallback; active line weight 600, inactive 400.

---

## Architecture

### Stack
| Layer | Technology |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS 3 |
| State | Zustand (persisted to localStorage) |
| Audio | Howler.js + Web Audio API + SoundTouchJS + AudioWorklet |
| AI Workers | @xenova/transformers (Whisper), ONNX Runtime Web (MDX-Net) |
| Japanese NLP | kuromoji.js, kuroshiro, wanakana |
| English NLP | compromise, CMUdict subset |
| Storage | OPFS (audio), IndexedDB/Dexie (metadata), Cache Storage (models), localStorage (settings) |
| PWA | vite-plugin-pwa + Workbox |
| Payment | LemonSqueezy overlay + jose JWT verification |
| Testing | Vitest + Playwright |

### Codebase Structure — Hybrid Feature-Slice

```
src/
├── core/           # Shared: db schema, opfs utils, global types, shared UI
├── player/         # AudioEngine, SpeedControl, ABLoop, PlayerStore, PlayerView, TapSyncEditor
├── lyrics/         # lrc-parser, LyricDisplay, AlignmentEditor, exporter
├── sources/        # youtube.ts (oEmbed), lrclib.ts, LinkParser.tsx
├── ai-pipeline/    # whisper.worker, demucs.worker, aligner, AutoAlignFlow, capability
├── language/
│   ├── japanese/   # tokenizer, phonetics, grammar
│   └── english/    # tokenizer, phonetics, grammar
│   └── WordAlignment.tsx
├── cloze/          # ClozeEngine, ClozeOverlay
├── payment/        # license.ts (JWT), trial.ts, UpgradeModal
└── settings/       # SettingsView
```

Feature slices are isolated; they only import from `core/`. No cross-slice imports.

---

## State Management

Three Zustand stores, each persisted independently:

```ts
PlayerStore     // currentSongId, playbackState, position, speed, abLoop
LyricsStore     // activeLine, phoneticMode, clozeMode, wordAlignment
SettingsStore   // isPro, trialCount, theme, deviceFingerprint, licenseKey
```

`activeLine` is derived in `LyricsStore` via binary search over `TimedLine[].startTime` on each `AudioEngine.onTimeUpdate` (~100ms interval). Only the changed line re-renders.

---

## Critical Data Flows

1. **Link paste → player:** `LinkParser` → `youtube.ts` (oEmbed metadata) + `lrclib.ts` (synced lyrics) → write `Song` to Dexie → navigate to `PlayerView`
2. **Audio upload:** file input → `ArrayBuffer` → `opfs/saveAudio(songId, buffer)` → `Song.audioStoredPath` saved in Dexie → Howler loads `File` from OPFS
3. **Auto-align:** `AudioEngine` extracts PCM → `demucs.worker` (optional, device-tier dependent) → `whisper.worker` → `aligner.ts` DP → timestamps written to `Song.alignment`
4. **Playback sync:** `AudioEngine.onTimeUpdate` → `PlayerStore.position` → `LyricsStore.activeLine` (binary search) → `LyricDisplay` re-renders active line only
5. **YouTube mode (free):** Howler bypassed; `YT.Player` instance polled via `getCurrentTime()` at ~100ms to drive `PlayerStore.position` for lyric sync
6. **Pro gate:** every Pro feature checks `SettingsStore.isPro || song.isTrialSong`; if false → `UpgradeModal`

---

## Data Models

```ts
interface Song {
  id: string;
  title: string;
  artist: string;
  sourceUrl?: string;
  audioStoredPath?: string;   // 'songs/<uuid>.mp3' in OPFS
  lyrics: LyricsData;
  alignment?: WordAlignment[];
  stats?: PracticeStats;
  createdAt: Date;
  isTrialSong: boolean;
}

interface TimedLine {
  startTime: number;
  endTime: number;
  original: string;
  translation: string;
  tokens?: Token[];
  reading?: string;           // romaji for JA, IPA for EN
}

interface UserSettings {
  proLicense: string | null;
  isPro: boolean;
  trialSongsClaimed: number;  // max 2
  deviceFingerprint: string;
  theme: 'light' | 'dark';
  defaultSpeed: number;
  clozeDifficulty: 'easy' | 'medium' | 'hard';
}
```

---

## Feature Gates

| Feature | Free | Trial (2 songs) | Pro |
|---|---|---|---|
| YouTube embed + synced lyrics | ✅ | ✅ | ✅ |
| Tap-to-sync editor | ✅ | ✅ | ✅ |
| Phonetic reading display | ✅ | ✅ | ✅ |
| Line-click seeking | ✅ | ✅ | ✅ |
| Local audio upload + offline | ❌ | ✅ | ✅ |
| Speed control (pitch-preserved) | ❌ | ✅ | ✅ |
| A-B loop + crossfade | ❌ | ✅ | ✅ |
| Auto-alignment (Whisper) | ❌ | ✅ | ✅ |
| Vocal separation | ❌ | ✅ | ✅ |
| Word-level alignment + grammar | ❌ | ✅ | ✅ |
| Cloze mode | ❌ | ✅ | ✅ |
| Export LRC/SRT | ❌ | ✅ | ✅ |
| Unlimited songs | ❌ | ❌ | ✅ |

Trial songs remain fully Pro-enabled forever after being claimed.

---

## Monetisation

- **Price:** $9.99 one-time via LemonSqueezy (merchant of record)
- **License:** JWT signed by LemonSqueezy private key, verified client-side with embedded public key via `jose`
- **Trial:** 2 slots tracked in `localStorage` with device fingerprint. Clearing site data may reset — acceptable for a $10 app.
- **Restore:** User re-enters license key; LemonSqueezy self-service portal for key recovery.

---

## AI Pipeline & Device Tiers

```ts
function getDeviceTier(): 'full' | 'lite' | 'manual' {
  const gpu = !!navigator.gpu;
  const memory = (navigator as any).deviceMemory || 4;
  if (gpu && memory >= 6) return 'full';   // vocal sep + transcription
  if (gpu && memory >= 4) return 'lite';   // transcription only
  return 'manual';                          // tap editor only
}
```

Models cached in Cache Storage with versioned URLs (`CacheFirst`, 30-day expiration). Models: Whisper-small quantized (~250 MB), MDX-Net ONNX (~30 MB).

---

## Phase Plan

### Phase 1 — Foundation & Core Player (Weeks 1–3)
Vite + React + Tailwind + Zustand scaffold. Dexie schema + OPFS utilities. Howler.js + `PlayerStore`. LRC parser → `TimedLine[]`. `PlayerView` in Cinnabar focus-mode layout with dummy timed lyrics. `TapSyncEditor`. PWA shell. Service worker caches app shell only.

**Exit criteria:** offline karaoke player with manually timed lyrics works end-to-end.

### Phase 2 — Free Tier & Link Parsing (Weeks 4–5)
YouTube oEmbed fetch. LRCLIB search/fetch. YouTube IFrame embed with `postMessage` lyric sync. Pro/free feature gates. Trial counter + device fingerprint. `UpgradeModal` (no payment yet).

**Exit criteria:** paste a YouTube link, get synced lyrics, see Pro locks on gated features.

### Phase 3 — Pro Audio & AI (Weeks 6–8)
SoundTouchJS speed control. A-B loop + crossfade AudioWorklet. `whisper.worker.ts` + `demucs.worker.ts`. `AutoAlignFlow` with tier detection + progress modal. Workbox runtime caching for models.

**Exit criteria:** full Pro audio + auto-alignment works on a 4-minute song in < 3 min on flagship device.

### Phase 4 — Language Features & Cloze (Weeks 9–10)
Japanese: kuromoji + kuroshiro/wanakana + grammar tooltips. English: compromise + CMUdict IPA + grammar explanations. `WordAlignment.tsx`. `ClozeEngine` + `ClozeOverlay`. LRC/SRT export.

**Exit criteria:** word-level alignment and grammar tooltips render correctly for both JA→EN and EN→JA.

### Phase 5 — Monetisation, Polish & Store Wrap (Weeks 11–12)
LemonSqueezy checkout wired to `UpgradeModal`. `jose` JWT license verification. Storage management UI. Quota warnings. Mobile polish (iPhone Safari, Android Chrome). Optional PWABuilder app store wrap.

**Exit criteria:** purchase flow completes, license validates offline, Pro features unlock permanently.

---

## Testing

- **Unit (Vitest):** LRC parser, DP aligner, JWT validation, grammar pattern matching, trial counter logic
- **Integration:** OPFS read/write, Dexie migrations, Workbox cache behaviour
- **Manual device matrix:** iPhone 15+ (Safari), flagship Android (Chrome), mid-range Android, desktop
- **Performance budgets:** app shell < 2s on 4G, 4-min auto-align < 3 min on flagship

---

## Out of Scope (v1)

- Spotify API integration (metadata only; no audio streaming)
- Server-side processing of any kind
- Analytics or telemetry
- Multi-user or sync across devices
