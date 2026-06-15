# Utasync Implementation Plan — Phases 1–3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Utasync PWA foundation through a working offline player with AI auto-alignment (Phases 1–3 of 5).

**Architecture:** Hybrid feature-slice React 18 + Vite app. Each feature slice (`player/`, `lyrics/`, `sources/`, `ai-pipeline/`) imports only from `core/`. Three Zustand stores (PlayerStore, LyricsStore, SettingsStore) persisted to localStorage. Audio in OPFS, metadata in IndexedDB (Dexie), AI models in Cache Storage.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS 3, Zustand, Howler.js, Dexie.js, @xenova/transformers, onnxruntime-web, SoundTouchJS, vite-plugin-pwa, Vitest

---

## File Map

```
src/
├── core/
│   ├── db/schema.ts           # Dexie class + Song/Settings tables
│   ├── opfs/audio.ts          # saveAudio, getAudioFile, deleteAudio
│   ├── types/index.ts         # Song, TimedLine, Token, WordAlignment, UserSettings, LyricsData
│   ├── storage/quota.ts       # requestPersistence, estimateQuota
│   └── ui/
│       ├── Button.tsx         # Shared button (variant: primary|ghost|lock)
│       ├── Modal.tsx          # Shared modal wrapper
│       └── Toast.tsx          # Toast notifications
├── player/
│   ├── AudioEngine.ts         # Howler.js wrapper; emits onTimeUpdate, onEnd
│   ├── SpeedControl.ts        # SoundTouchJS pitch-preserved speed (Phase 3)
│   ├── ABLoop.ts              # A-B loop state + crossfade logic (Phase 3)
│   ├── crossfade.worklet.ts   # AudioWorklet processor (Phase 3)
│   ├── PlayerStore.ts         # Zustand: currentSongId, position, speed, abLoop, playbackState
│   ├── PlayerView.tsx         # Focus-mode karaoke screen
│   └── TapSyncEditor.tsx      # Manual timestamp editor
├── lyrics/
│   ├── lrc-parser.ts          # LRC string → TimedLine[]
│   ├── LyricDisplay.tsx       # Active/prev/next lines + phonetic toggle
│   └── AlignmentEditor.tsx    # Side-by-side line pairing UI
├── sources/
│   ├── youtube.ts             # oEmbed fetch → {title, artist}
│   ├── lrclib.ts              # LRCLIB search → TimedLine[] | string
│   └── LinkParser.tsx         # Landing page input + flow router (Phase 2)
├── ai-pipeline/
│   ├── capability.ts          # getDeviceTier()
│   ├── aligner.ts             # DP word→line alignment
│   ├── whisper.worker.ts      # @xenova/transformers transcription
│   ├── demucs.worker.ts       # ONNX vocal separation
│   └── AutoAlignFlow.tsx      # Progress modal + orchestration
├── payment/
│   ├── trial.ts               # Trial slot logic + device fingerprint
│   └── UpgradeModal.tsx       # Pro gate modal (Phase 2, no payment yet)
├── App.tsx
├── main.tsx
└── sw.ts
tests/
├── core/lrc-parser.test.ts
├── core/opfs.test.ts
├── sources/youtube.test.ts
├── sources/lrclib.test.ts
├── ai-pipeline/aligner.test.ts
└── payment/trial.test.ts
```

---

## PHASE 1 — Foundation & Core Player

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`

- [ ] **Step 1: Scaffold with Vite**

```bash
cd /Users/ninjaruss/Documents/GitHub/utasync
npm create vite@latest . -- --template react-ts
npm install
```

- [ ] **Step 2: Install all dependencies**

```bash
npm install zustand dexie howler @types/howler \
  @xenova/transformers onnxruntime-web \
  compromise kuromoji kuroshiro kuroshiro-converter-rom wanakana \
  jose uuid
npm install -D vitest @vitest/ui jsdom @testing-library/react \
  @testing-library/jest-dom @testing-library/user-event \
  vite-plugin-pwa workbox-window tailwindcss postcss autoprefixer \
  @types/uuid @types/wanakana
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind with Cinnabar theme**

Replace `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cinnabar: {
          950: '#0d0404',
          900: '#180606',
          800: '#2c0808',
          700: '#3d0f0f',
          accent: '#f87171',
          glow: 'rgba(248,113,113,0.5)',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        jp: ['"Hiragino Sans"', '"Yu Gothic"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 4: Configure Vite**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-models-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: 'Utasync',
        short_name: 'Utasync',
        description: 'Learn languages through music',
        theme_color: '#0d0404',
        background_color: '#0d0404',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
})
```

- [ ] **Step 5: Configure Vitest**

Add to `vite.config.ts` inside `defineConfig`:

```ts
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
```

Create `src/test-setup.ts`:

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Wire up App.tsx and main.tsx**

`src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/App.tsx`:
```tsx
import React from 'react'

export default function App() {
  return (
    <div className="min-h-screen bg-cinnabar-950 text-white flex items-center justify-center">
      <h1 className="text-2xl font-bold text-cinnabar-accent">Utasync</h1>
    </div>
  )
}
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev
```
Expected: browser shows "Utasync" in red on near-black background.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite/React/Tailwind/Zustand with Cinnabar theme"
```

---

### Task 2: Core types

**Files:**
- Create: `src/core/types/index.ts`

- [ ] **Step 1: Write types**

```ts
// src/core/types/index.ts
export type Language = 'ja' | 'en'
export type AlignmentMode = 'manual' | 'auto'
export type PhoneticMode = 'none' | 'reading' | 'translation'
export type ClozeDifficulty = 'easy' | 'medium' | 'hard'
export type DeviceTier = 'full' | 'lite' | 'manual'
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'loading'

export interface Token {
  surface: string
  reading?: string
  pos?: string
  startIndex: number
  endIndex: number
  alignmentIndices?: number[]
}

export interface TimedLine {
  startTime: number
  endTime: number
  original: string
  translation: string
  tokens?: Token[]
  reading?: string
}

export interface LyricsData {
  lines: TimedLine[]
  sourceLanguage: Language
  translationLanguage: Language
  alignmentMode: AlignmentMode
}

export interface WordAlignment {
  sourceTokenIndices: number[]
  targetWordIndices: number[]
  lineIndex: number
}

export interface PracticeStats {
  totalPlays: number
  totalLoopTime: number
  clozeAttempts: number
  clozeCorrect: number
  lastPracticed: Date
}

export interface Song {
  id: string
  title: string
  artist: string
  sourceUrl?: string
  audioStoredPath?: string
  lyrics: LyricsData
  alignment?: WordAlignment[]
  stats?: PracticeStats
  createdAt: Date
  isTrialSong: boolean
}

export interface UserSettings {
  proLicense: string | null
  isPro: boolean
  trialSongsClaimed: number
  deviceFingerprint: string
  theme: 'light' | 'dark'
  defaultSpeed: number
  clozeDifficulty: ClozeDifficulty
}

export interface ABLoop {
  a: number | null
  b: number | null
  preRoll: number
  loopCount: number
  crossfadeDuration: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/types/index.ts
git commit -m "feat: add core TypeScript types"
```

---

### Task 3: Dexie database schema

**Files:**
- Create: `src/core/db/schema.ts`
- Create: `tests/core/db.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/core/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../src/core/db/schema'
import type { Song } from '../../src/core/types'

const mockSong: Song = {
  id: 'test-1',
  title: 'Test Song',
  artist: 'Test Artist',
  lyrics: {
    lines: [{ startTime: 0, endTime: 2, original: 'こんにちは', translation: 'Hello' }],
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    alignmentMode: 'manual',
  },
  createdAt: new Date(),
  isTrialSong: false,
}

beforeEach(async () => {
  await db.songs.clear()
})

describe('db.songs', () => {
  it('stores and retrieves a song by id', async () => {
    await db.songs.put(mockSong)
    const result = await db.songs.get('test-1')
    expect(result?.title).toBe('Test Song')
  })

  it('lists all songs', async () => {
    await db.songs.put(mockSong)
    const all = await db.songs.toArray()
    expect(all).toHaveLength(1)
  })

  it('deletes a song', async () => {
    await db.songs.put(mockSong)
    await db.songs.delete('test-1')
    const result = await db.songs.get('test-1')
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/core/db.test.ts
```
Expected: `Error: Cannot find module '../../src/core/db/schema'`

- [ ] **Step 3: Implement schema**

```ts
// src/core/db/schema.ts
import Dexie, { type Table } from 'dexie'
import type { Song } from '../types'

class UtasyncDB extends Dexie {
  songs!: Table<Song, string>

  constructor() {
    super('utasync')
    this.version(1).stores({
      songs: 'id, title, artist, createdAt',
    })
  }
}

export const db = new UtasyncDB()
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/core/db.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/db/schema.ts tests/core/db.test.ts
git commit -m "feat: add Dexie database schema with Song table"
```

---

### Task 4: OPFS audio utilities

**Files:**
- Create: `src/core/opfs/audio.ts`
- Create: `tests/core/opfs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/core/opfs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock OPFS since jsdom doesn't support it
const mockWritable = { write: vi.fn(), close: vi.fn() }
const mockFileHandle = {
  createWritable: vi.fn().mockResolvedValue(mockWritable),
  getFile: vi.fn().mockResolvedValue(new File([new ArrayBuffer(8)], 'test.mp3')),
}
const mockSongsDir = {
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
}
const mockRoot = {
  getDirectoryHandle: vi.fn().mockResolvedValue(mockSongsDir),
}

vi.stubGlobal('navigator', {
  storage: {
    getDirectory: vi.fn().mockResolvedValue(mockRoot),
    persist: vi.fn().mockResolvedValue(true),
  },
})

import { saveAudio, getAudioFile, deleteAudio } from '../../src/core/opfs/audio'

describe('OPFS audio utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoot.getDirectoryHandle.mockResolvedValue(mockSongsDir)
    mockSongsDir.getFileHandle.mockResolvedValue(mockFileHandle)
    mockFileHandle.createWritable.mockResolvedValue(mockWritable)
  })

  it('saveAudio writes buffer to OPFS', async () => {
    const buffer = new ArrayBuffer(8)
    await saveAudio('song-1', buffer)
    expect(mockWritable.write).toHaveBeenCalledWith(buffer)
    expect(mockWritable.close).toHaveBeenCalled()
  })

  it('getAudioFile retrieves File from OPFS', async () => {
    const file = await getAudioFile('song-1')
    expect(file).toBeInstanceOf(File)
  })

  it('deleteAudio removes file handle', async () => {
    const mockRemove = vi.fn()
    mockSongsDir.getFileHandle.mockResolvedValue({ ...mockFileHandle, remove: mockRemove })
    // deleteAudio calls remove() on the file handle
    await deleteAudio('song-1')
    expect(mockRemove).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/core/opfs.test.ts
```
Expected: `Error: Cannot find module '../../src/core/opfs/audio'`

- [ ] **Step 3: Implement OPFS utilities**

```ts
// src/core/opfs/audio.ts
async function getSongsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('songs', { create: true })
}

export async function saveAudio(songId: string, buffer: ArrayBuffer): Promise<void> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`, { create: true })
  const writable = await (file as any).createWritable()
  await writable.write(buffer)
  await writable.close()
}

export async function getAudioFile(songId: string): Promise<File> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`)
  return (file as any).getFile()
}

export async function deleteAudio(songId: string): Promise<void> {
  const dir = await getSongsDir()
  const file = await dir.getFileHandle(`${songId}.mp3`)
  await (file as any).remove()
}

export function audioStoragePath(songId: string): string {
  return `songs/${songId}.mp3`
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/core/opfs.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/opfs/audio.ts tests/core/opfs.test.ts
git commit -m "feat: add OPFS audio save/get/delete utilities"
```

---

### Task 5: LRC parser

**Files:**
- Create: `src/lyrics/lrc-parser.ts`
- Create: `tests/lyrics/lrc-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/lyrics/lrc-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseLRC, parseLRCPair } from '../../src/lyrics/lrc-parser'

const jaLRC = `[00:12.50]星に願いを
[00:15.20]夢の中で待ってる
[00:18.90]朝が来るまで`

const enLRC = `[00:12.50]Wish upon a star
[00:15.20]Waiting in my dreams
[00:18.90]Until morning comes`

describe('parseLRC', () => {
  it('parses timestamps correctly', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].startTime).toBeCloseTo(12.5)
    expect(lines[1].startTime).toBeCloseTo(15.2)
  })

  it('parses text content', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].original).toBe('星に願いを')
  })

  it('sets endTime to next line startTime', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].endTime).toBeCloseTo(15.2)
  })

  it('sets last line endTime to startTime + 5', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[2].endTime).toBeCloseTo(23.9)
  })

  it('skips metadata lines', () => {
    const lrc = `[ti:Test Song]\n[ar:Artist]\n[00:01.00]Line one`
    const lines = parseLRC(lrc)
    expect(lines).toHaveLength(1)
    expect(lines[0].original).toBe('Line one')
  })

  it('returns empty array for empty input', () => {
    expect(parseLRC('')).toEqual([])
  })
})

describe('parseLRCPair', () => {
  it('merges two LRC files into bilingual lines', () => {
    const lines = parseLRCPair(jaLRC, enLRC)
    expect(lines[0].original).toBe('星に願いを')
    expect(lines[0].translation).toBe('Wish upon a star')
    expect(lines[0].startTime).toBeCloseTo(12.5)
  })

  it('handles mismatched line counts gracefully', () => {
    const shortEn = `[00:12.50]Wish upon a star`
    const lines = parseLRCPair(jaLRC, shortEn)
    expect(lines).toHaveLength(3)
    expect(lines[1].translation).toBe('')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lyrics/lrc-parser.test.ts
```
Expected: `Error: Cannot find module '../../src/lyrics/lrc-parser'`

- [ ] **Step 3: Implement LRC parser**

```ts
// src/lyrics/lrc-parser.ts
import type { TimedLine } from '../core/types'

const TIMESTAMP_RE = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/
const METADATA_RE = /^\[(?:ti|ar|al|by|offset|re|ve):/i

function parseTimestamp(line: string): { time: number; text: string } | null {
  const match = line.match(TIMESTAMP_RE)
  if (!match) return null
  const minutes = parseInt(match[1])
  const seconds = parseInt(match[2])
  const centiseconds = match[3].length === 3
    ? parseInt(match[3]) / 1000
    : parseInt(match[3]) / 100
  const time = minutes * 60 + seconds + centiseconds
  const text = line.slice(match[0].length).trim()
  return { time, text }
}

export function parseLRC(lrc: string): TimedLine[] {
  const lines: Array<{ startTime: number; text: string }> = []

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed || METADATA_RE.test(trimmed)) continue
    const parsed = parseTimestamp(trimmed)
    if (parsed) lines.push({ startTime: parsed.time, text: parsed.text })
  }

  lines.sort((a, b) => a.startTime - b.startTime)

  return lines.map((line, i): TimedLine => ({
    startTime: line.startTime,
    endTime: lines[i + 1]?.startTime ?? line.startTime + 5,
    original: line.text,
    translation: '',
  }))
}

export function parseLRCPair(originalLRC: string, translationLRC: string): TimedLine[] {
  const origLines = parseLRC(originalLRC)
  const transLines = parseLRC(translationLRC)

  return origLines.map((line, i): TimedLine => ({
    ...line,
    translation: transLines[i]?.original ?? '',
  }))
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/lyrics/lrc-parser.test.ts
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/lrc-parser.ts tests/lyrics/lrc-parser.test.ts
git commit -m "feat: add LRC parser with bilingual pair merging"
```

---

### Task 6: Zustand stores

**Files:**
- Create: `src/player/PlayerStore.ts`
- Create: `src/lyrics/LyricsStore.ts`
- Create: `src/payment/SettingsStore.ts`

- [ ] **Step 1: PlayerStore**

```ts
// src/player/PlayerStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackState, ABLoop } from '../core/types'

interface PlayerState {
  currentSongId: string | null
  playbackState: PlaybackState
  position: number
  duration: number
  speed: number
  abLoop: ABLoop
  setCurrentSong: (id: string | null) => void
  setPlaybackState: (state: PlaybackState) => void
  setPosition: (pos: number) => void
  setDuration: (dur: number) => void
  setSpeed: (speed: number) => void
  setABLoop: (loop: Partial<ABLoop>) => void
}

const DEFAULT_AB_LOOP: ABLoop = {
  a: null,
  b: null,
  preRoll: 2,
  loopCount: 3,
  crossfadeDuration: 0.3,
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      currentSongId: null,
      playbackState: 'idle',
      position: 0,
      duration: 0,
      speed: 1,
      abLoop: DEFAULT_AB_LOOP,
      setCurrentSong: (id) => set({ currentSongId: id, position: 0, playbackState: 'idle' }),
      setPlaybackState: (playbackState) => set({ playbackState }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setSpeed: (speed) => set({ speed }),
      setABLoop: (loop) => set((s) => ({ abLoop: { ...s.abLoop, ...loop } })),
    }),
    { name: 'utasync-player' }
  )
)
```

- [ ] **Step 2: LyricsStore**

```ts
// src/lyrics/LyricsStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TimedLine, PhoneticMode, ClozeDifficulty } from '../core/types'

interface LyricsState {
  lines: TimedLine[]
  activeLine: number
  phoneticMode: PhoneticMode
  clozeMode: boolean
  clozeDifficulty: ClozeDifficulty
  setLines: (lines: TimedLine[]) => void
  syncPosition: (position: number) => void
  setPhoneticMode: (mode: PhoneticMode) => void
  setClozeMode: (on: boolean) => void
}

function binarySearchLine(lines: TimedLine[], position: number): number {
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].startTime <= position) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

export const useLyricsStore = create<LyricsState>()(
  persist(
    (set, get) => ({
      lines: [],
      activeLine: -1,
      phoneticMode: 'reading',
      clozeMode: false,
      clozeDifficulty: 'medium',
      setLines: (lines) => set({ lines, activeLine: -1 }),
      syncPosition: (position) => {
        const { lines, activeLine } = get()
        const next = binarySearchLine(lines, position)
        if (next !== activeLine) set({ activeLine: next })
      },
      setPhoneticMode: (phoneticMode) => set({ phoneticMode }),
      setClozeMode: (clozeMode) => set({ clozeMode }),
    }),
    { name: 'utasync-lyrics', partialize: (s) => ({ phoneticMode: s.phoneticMode, clozeDifficulty: s.clozeDifficulty }) }
  )
)
```

- [ ] **Step 3: SettingsStore**

```ts
// src/payment/SettingsStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserSettings } from '../core/types'

function generateFingerprint(): string {
  const nav = navigator
  const parts = [
    nav.language,
    nav.hardwareConcurrency,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ]
  return btoa(parts.join('|')).slice(0, 32)
}

interface SettingsState extends UserSettings {
  setIsPro: (val: boolean) => void
  setLicense: (key: string) => void
  incrementTrial: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      proLicense: null,
      isPro: false,
      trialSongsClaimed: 0,
      deviceFingerprint: generateFingerprint(),
      theme: 'dark',
      defaultSpeed: 1,
      clozeDifficulty: 'medium',
      setIsPro: (isPro) => set({ isPro }),
      setLicense: (proLicense) => set({ proLicense, isPro: true }),
      incrementTrial: () => set((s) => ({ trialSongsClaimed: s.trialSongsClaimed + 1 })),
    }),
    { name: 'utasync-settings' }
  )
)
```

- [ ] **Step 4: Commit**

```bash
git add src/player/PlayerStore.ts src/lyrics/LyricsStore.ts src/payment/SettingsStore.ts
git commit -m "feat: add PlayerStore, LyricsStore, SettingsStore with Zustand persist"
```

---

### Task 7: AudioEngine

**Files:**
- Create: `src/player/AudioEngine.ts`

- [ ] **Step 1: Implement**

```ts
// src/player/AudioEngine.ts
import { Howl } from 'howler'

type TimeUpdateHandler = (position: number) => void
type StateHandler = () => void

export class AudioEngine {
  private howl: Howl | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private onTimeUpdateCb: TimeUpdateHandler | null = null
  private onEndCb: StateHandler | null = null

  onTimeUpdate(cb: TimeUpdateHandler) { this.onTimeUpdateCb = cb }
  onEnd(cb: StateHandler) { this.onEndCb = cb }

  load(src: string | File): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = src instanceof File ? URL.createObjectURL(src) : src
      this.destroy()
      this.howl = new Howl({
        src: [url],
        format: ['mp3', 'm4a', 'ogg'],
        html5: true,
        onload: () => resolve(),
        onloaderror: (_id, err) => reject(err),
        onend: () => { this.onEndCb?.(); this.stopTicker() },
      })
    })
  }

  play() {
    this.howl?.play()
    this.startTicker()
  }

  pause() {
    this.howl?.pause()
    this.stopTicker()
  }

  seek(seconds: number) {
    this.howl?.seek(seconds)
  }

  get position(): number {
    return (this.howl?.seek() as number) ?? 0
  }

  get duration(): number {
    return this.howl?.duration() ?? 0
  }

  private startTicker() {
    this.stopTicker()
    this.ticker = setInterval(() => {
      this.onTimeUpdateCb?.(this.position)
    }, 100)
  }

  private stopTicker() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null }
  }

  destroy() {
    this.stopTicker()
    this.howl?.unload()
    this.howl = null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/player/AudioEngine.ts
git commit -m "feat: add Howler-based AudioEngine with 100ms time update ticker"
```

---

### Task 8: LyricDisplay component

**Files:**
- Create: `src/lyrics/LyricDisplay.tsx`

- [ ] **Step 1: Implement Focus Mode karaoke display**

```tsx
// src/lyrics/LyricDisplay.tsx
import React from 'react'
import { useLyricsStore } from './LyricsStore'
import type { TimedLine } from '../core/types'

interface Props {
  onSeek: (time: number) => void
}

function Line({ line, state, onSeek }: {
  line: TimedLine
  state: 'prev' | 'active' | 'next' | 'hidden'
  onSeek: (t: number) => void
}) {
  const isActive = state === 'active'
  const isAdjacent = state === 'prev' || state === 'next'

  return (
    <div
      onClick={() => onSeek(line.startTime)}
      className={[
        'cursor-pointer select-none transition-all duration-300 text-center px-4 py-2',
        isActive ? 'py-6' : '',
      ].join(' ')}
    >
      <div className={[
        'font-jp transition-all duration-300',
        isActive
          ? 'text-2xl font-semibold text-white'
          : isAdjacent
            ? 'text-base font-normal text-cinnabar-800/60'
            : 'text-sm font-normal text-cinnabar-800/30',
      ].join(' ')}
        style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
      >
        {line.original}
      </div>

      {isActive && line.reading && (
        <div className="text-sm text-cinnabar-accent/80 mt-1">{line.reading}</div>
      )}

      {isActive && line.translation && (
        <div className="text-base italic text-white/70 mt-1">{line.translation}</div>
      )}
    </div>
  )
}

export function LyricDisplay({ onSeek }: Props) {
  const { lines, activeLine } = useLyricsStore()

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-cinnabar-800/40 text-sm">
        No lyrics loaded
      </div>
    )
  }

  const visible = [activeLine - 1, activeLine, activeLine + 1, activeLine + 2]

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
      {lines.map((line, i) => {
        const offset = i - activeLine
        if (offset < -1 || offset > 2) return null
        const state = offset === 0 ? 'active' : offset === -1 ? 'prev' : 'next'
        return <Line key={i} line={line} state={state} onSeek={onSeek} />
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx
git commit -m "feat: add LyricDisplay focus-mode karaoke component"
```

---

### Task 9: PlayerView — core screen

**Files:**
- Create: `src/player/PlayerView.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/player/PlayerView.tsx
import React, { useEffect, useRef } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { AudioEngine } from './AudioEngine'
import { LyricDisplay } from '../lyrics/LyricDisplay'

export function PlayerView() {
  const engine = useRef<AudioEngine>(new AudioEngine())
  const { playbackState, position, speed, setPlaybackState, setPosition, setDuration } = usePlayerStore()
  const { syncPosition } = useLyricsStore()

  useEffect(() => {
    const e = engine.current
    e.onTimeUpdate((pos) => {
      setPosition(pos)
      syncPosition(pos)
    })
    e.onEnd(() => setPlaybackState('idle'))
    return () => e.destroy()
  }, [])

  const togglePlay = () => {
    if (playbackState === 'playing') {
      engine.current.pause()
      setPlaybackState('paused')
    } else {
      engine.current.play()
      setPlaybackState('playing')
    }
  }

  const seek = (time: number) => {
    engine.current.seek(time)
    setPosition(time)
  }

  const duration = engine.current.duration || 1
  const progress = position / duration

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cinnabar-900">
        <span className="text-cinnabar-accent font-semibold tracking-widest text-sm uppercase">歌sync</span>
        <button className="text-white/40 hover:text-white text-xs">Settings</button>
      </div>

      {/* Lyrics area */}
      <LyricDisplay onSeek={seek} />

      {/* Playback controls */}
      <div className="px-4 pb-6 pt-2 space-y-3">
        {/* Seek bar */}
        <div
          className="h-1 bg-cinnabar-900 rounded cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seek(((e.clientX - rect.left) / rect.width) * duration)
          }}
        >
          <div
            className="h-full bg-cinnabar-accent rounded transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Time */}
        <div className="flex justify-between text-xs text-white/30">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-6">
          <button onClick={() => seek(Math.max(0, position - 5))}
            className="text-white/50 hover:text-white text-xl">⏮</button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full bg-cinnabar-accent text-white text-2xl flex items-center justify-center shadow-lg"
            style={{ boxShadow: '0 0 20px rgba(248,113,113,0.4)' }}
          >
            {playbackState === 'playing' ? '⏸' : '▶'}
          </button>
          <button onClick={() => seek(Math.min(duration, position + 5))}
            className="text-white/50 hover:text-white text-xl">⏭</button>
        </div>
      </div>
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
```

- [ ] **Step 2: Wire PlayerView into App.tsx**

```tsx
// src/App.tsx
import React from 'react'
import { PlayerView } from './player/PlayerView'
import { useLyricsStore } from './lyrics/LyricsStore'
import { parseLRCPair } from './lyrics/lrc-parser'

// Temporary seed with dummy lyrics for Phase 1 testing
const DEMO_JA = `[00:05.00]星に願いを
[00:08.00]夢の中で待ってる
[00:11.00]朝が来るまで
[00:14.00]ずっとここにいる`

const DEMO_EN = `[00:05.00]Wish upon a star
[00:08.00]Waiting in my dreams
[00:11.00]Until morning comes
[00:14.00]I'll always be here`

export default function App() {
  const { lines, setLines } = useLyricsStore()

  React.useEffect(() => {
    if (lines.length === 0) setLines(parseLRCPair(DEMO_JA, DEMO_EN))
  }, [])

  return <PlayerView />
}
```

- [ ] **Step 3: Run dev server and manually verify**

```bash
npm run dev
```
Expected: Cinnabar focus-mode player with demo lyrics. Click lyrics to seek. Play button visible.

- [ ] **Step 4: Commit**

```bash
git add src/player/PlayerView.tsx src/App.tsx
git commit -m "feat: add PlayerView with Cinnabar focus-mode karaoke layout"
```

---

### Task 10: TapSyncEditor

**Files:**
- Create: `src/player/TapSyncEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/player/TapSyncEditor.tsx
import React, { useState, useCallback } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  plainLines: string[]
  translations: string[]
  audioPosition: () => number
  onComplete: (lines: TimedLine[]) => void
}

export function TapSyncEditor({ plainLines, translations, audioPosition, onComplete }: Props) {
  const [tapped, setTapped] = useState<number[]>([])
  const current = tapped.length

  const handleTap = useCallback(() => {
    if (current >= plainLines.length) return
    setTapped((prev) => [...prev, audioPosition()])
  }, [current, plainLines.length, audioPosition])

  const handleFinish = () => {
    const lines: TimedLine[] = tapped.map((startTime, i) => ({
      startTime,
      endTime: tapped[i + 1] ?? startTime + 5,
      original: plainLines[i],
      translation: translations[i] ?? '',
    }))
    onComplete(lines)
  }

  const handleUndo = () => setTapped((prev) => prev.slice(0, -1))

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-white/40 text-sm">
        Line {current + 1} of {plainLines.length}
      </div>

      <div className="text-center space-y-2">
        <div className="text-2xl font-semibold text-white font-jp">
          {plainLines[current] ?? '—'}
        </div>
        {translations[current] && (
          <div className="text-white/60 italic">{translations[current]}</div>
        )}
      </div>

      {/* Previous lines tapped */}
      <div className="text-white/30 text-xs text-center max-w-xs">
        {tapped.slice(-3).map((t, i) => (
          <div key={i}>{plainLines[tapped.length - 3 + i]} @ {t.toFixed(2)}s</div>
        ))}
      </div>

      <button
        onClick={handleTap}
        disabled={current >= plainLines.length}
        className="w-32 h-32 rounded-full bg-cinnabar-accent text-white text-4xl shadow-lg active:scale-95 transition-transform disabled:opacity-30"
        style={{ boxShadow: '0 0 30px rgba(248,113,113,0.4)' }}
      >
        ⏎
      </button>

      <div className="flex gap-4">
        <button onClick={handleUndo} disabled={tapped.length === 0}
          className="px-4 py-2 text-white/50 hover:text-white text-sm disabled:opacity-30">
          ← Undo
        </button>
        {current >= plainLines.length && (
          <button onClick={handleFinish}
            className="px-6 py-2 bg-cinnabar-accent text-white rounded-full text-sm">
            Save & Practice
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/player/TapSyncEditor.tsx
git commit -m "feat: add TapSyncEditor for manual lyric timestamping"
```

---

### Task 11: Quota management + PWA verification

**Files:**
- Create: `src/core/storage/quota.ts`

- [ ] **Step 1: Implement**

```ts
// src/core/storage/quota.ts
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}

export async function estimateQuota(): Promise<{ used: number; total: number; ratio: number }> {
  if (!navigator.storage?.estimate) return { used: 0, total: 0, ratio: 0 }
  const { usage = 0, quota = 1 } = await navigator.storage.estimate()
  return { used: usage, total: quota, ratio: usage / quota }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
```

- [ ] **Step 2: Call requestPersistence on app startup**

Add to `src/main.tsx` after ReactDOM.createRoot:

```ts
import { requestPersistence } from './core/storage/quota'
requestPersistence()
```

- [ ] **Step 3: Build and verify PWA**

```bash
npm run build
npx vite preview
```
Expected: app loads, Lighthouse PWA score ≥ 90, service worker registered.

- [ ] **Step 4: Commit**

```bash
git add src/core/storage/quota.ts src/main.tsx
git commit -m "feat: add quota management and persistence request on startup"
```

---

## PHASE 2 — Free Tier & Link Parsing

### Task 12: YouTube oEmbed fetch

**Files:**
- Create: `src/sources/youtube.ts`
- Create: `tests/sources/youtube.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/sources/youtube.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()

import { fetchYouTubeMeta, extractVideoId } from '../../src/sources/youtube'

describe('extractVideoId', () => {
  it('extracts from standard URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('extracts from short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube URL', () => {
    expect(extractVideoId('https://spotify.com/track/xyz')).toBeNull()
  })
})

describe('fetchYouTubeMeta', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns title and author from oEmbed', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'Rick Astley - Never Gonna Give You Up', author_name: 'RickAstleyVEVO' }),
    })
    const meta = await fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(meta.title).toBe('Rick Astley - Never Gonna Give You Up')
    expect(meta.artist).toBe('RickAstleyVEVO')
  })

  it('throws on non-YouTube URL', async () => {
    await expect(fetchYouTubeMeta('https://spotify.com')).rejects.toThrow('Not a YouTube URL')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/sources/youtube.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/sources/youtube.ts
export interface YouTubeMeta {
  title: string
  artist: string
  videoId: string
  thumbnailUrl: string
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    return null
  } catch {
    return null
  }
}

export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('Not a YouTube URL')

  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  const res = await fetch(oembedUrl)
  if (!res.ok) throw new Error(`oEmbed fetch failed: ${res.status}`)
  const data = await res.json()

  return {
    title: data.title,
    artist: data.author_name,
    videoId,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/sources/youtube.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/youtube.ts tests/sources/youtube.test.ts
git commit -m "feat: add YouTube oEmbed metadata fetch"
```

---

### Task 13: LRCLIB integration

**Files:**
- Create: `src/sources/lrclib.ts`
- Create: `tests/sources/lrclib.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/sources/lrclib.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()

import { searchLRCLIB, LRCLIBResult } from '../../src/sources/lrclib'

const mockResult: LRCLIBResult = {
  id: 1,
  trackName: 'Test',
  artistName: 'Tester',
  syncedLyrics: '[00:01.00]Hello\n[00:03.00]World',
  plainLyrics: 'Hello\nWorld',
}

describe('searchLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns results for a query', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [mockResult] })
    const results = await searchLRCLIB({ artist: 'Tester', title: 'Test' })
    expect(results).toHaveLength(1)
    expect(results[0].syncedLyrics).toContain('[00:01.00]')
  })

  it('returns empty array on 404', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 404 })
    const results = await searchLRCLIB({ artist: 'Nobody', title: 'Nothing' })
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/sources/lrclib.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/sources/lrclib.ts
export interface LRCLIBResult {
  id: number
  trackName: string
  artistName: string
  syncedLyrics: string | null
  plainLyrics: string | null
}

export async function searchLRCLIB({ artist, title }: { artist: string; title: string }): Promise<LRCLIBResult[]> {
  const q = encodeURIComponent(`${artist} ${title}`)
  const res = await fetch(`https://lrclib.net/api/search?q=${q}`)
  if (!res.ok) return []
  return res.json()
}

export async function getLRCLIBById(id: number): Promise<LRCLIBResult | null> {
  const res = await fetch(`https://lrclib.net/api/get/${id}`)
  if (!res.ok) return null
  return res.json()
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/sources/lrclib.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sources/lrclib.ts tests/sources/lrclib.test.ts
git commit -m "feat: add LRCLIB search and fetch integration"
```

---

### Task 14: Trial counter + Pro gate

**Files:**
- Create: `src/payment/trial.ts`
- Create: `tests/payment/trial.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/payment/trial.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock SettingsStore
const mockSettings = { isPro: false, trialSongsClaimed: 0, incrementTrial: vi.fn() }
vi.mock('../src/payment/SettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings }
}))

import { canUsePro, claimTrialSlot, TRIAL_LIMIT } from '../../src/payment/trial'

describe('canUsePro', () => {
  beforeEach(() => {
    mockSettings.isPro = false
    mockSettings.trialSongsClaimed = 0
  })

  it('returns true when isPro', () => {
    mockSettings.isPro = true
    expect(canUsePro(false)).toBe(true)
  })

  it('returns true for a trial song', () => {
    expect(canUsePro(true)).toBe(true)
  })

  it('returns false when not pro and not trial song', () => {
    expect(canUsePro(false)).toBe(false)
  })
})

describe('claimTrialSlot', () => {
  it('returns true and increments when slots remain', () => {
    mockSettings.trialSongsClaimed = 0
    const result = claimTrialSlot()
    expect(result).toBe(true)
    expect(mockSettings.incrementTrial).toHaveBeenCalled()
  })

  it('returns false when trial limit reached', () => {
    mockSettings.trialSongsClaimed = 2
    const result = claimTrialSlot()
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run tests/payment/trial.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/payment/trial.ts
import { useSettingsStore } from './SettingsStore'

export const TRIAL_LIMIT = 2

export function canUsePro(isTrialSong: boolean): boolean {
  const { isPro } = useSettingsStore.getState()
  return isPro || isTrialSong
}

export function claimTrialSlot(): boolean {
  const { trialSongsClaimed, incrementTrial } = useSettingsStore.getState()
  if (trialSongsClaimed >= TRIAL_LIMIT) return false
  incrementTrial()
  return true
}

export function trialSlotsRemaining(): number {
  const { isPro, trialSongsClaimed } = useSettingsStore.getState()
  if (isPro) return Infinity
  return Math.max(0, TRIAL_LIMIT - trialSongsClaimed)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/payment/trial.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/payment/trial.ts tests/payment/trial.test.ts
git commit -m "feat: add trial slot logic with Pro gate check"
```

---

### Task 15: UpgradeModal + LinkParser

**Files:**
- Create: `src/payment/UpgradeModal.tsx`
- Create: `src/sources/LinkParser.tsx`

- [ ] **Step 1: UpgradeModal (no payment yet)**

```tsx
// src/payment/UpgradeModal.tsx
import React from 'react'
import { trialSlotsRemaining, TRIAL_LIMIT } from './trial'
import { useSettingsStore } from './SettingsStore'

interface Props {
  feature: string
  onClose: () => void
}

export function UpgradeModal({ feature, onClose }: Props) {
  const remaining = trialSlotsRemaining()
  const { isPro } = useSettingsStore()

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold text-lg">Unlock {feature}</h2>

        {remaining > 0 ? (
          <p className="text-white/70 text-sm">
            You have <span className="text-cinnabar-accent font-bold">{remaining}</span> free trial {remaining === 1 ? 'song' : 'songs'} left.
            This song will use one.
          </p>
        ) : (
          <p className="text-white/70 text-sm">
            You've used all {TRIAL_LIMIT} free trials.
            Unlock Pro for <span className="text-cinnabar-accent font-bold">$9.99</span> — one time, forever.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {remaining > 0 && (
            <button className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium" onClick={onClose}>
              Use trial slot
            </button>
          )}
          <button className="w-full py-3 bg-white text-cinnabar-950 rounded-xl font-bold">
            Unlock Pro — $9.99
          </button>
          <button onClick={onClose} className="text-white/40 text-sm text-center py-1">
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: LinkParser (landing page)**

```tsx
// src/sources/LinkParser.tsx
import React, { useState } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { searchLRCLIB } from './lrclib'
import { parseLRCPair, parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { v4 as uuidv4 } from 'uuid'
import type { Song } from '../core/types'

interface Props {
  onSongReady: (songId: string) => void
}

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleParse = async () => {
    setError('')
    setStatus('Fetching song info…')
    try {
      const meta = await fetchYouTubeMeta(url)
      setStatus('Searching for lyrics…')
      const results = await searchLRCLIB({ artist: meta.artist, title: meta.title })
      const best = results.find((r) => r.syncedLyrics) ?? results[0]
      const lines = best?.syncedLyrics
        ? parseLRC(best.syncedLyrics)
        : []

      const song: Song = {
        id: uuidv4(),
        title: meta.title,
        artist: meta.artist,
        sourceUrl: url,
        lyrics: {
          lines,
          sourceLanguage: 'ja',
          translationLanguage: 'en',
          alignmentMode: 'manual',
        },
        createdAt: new Date(),
        isTrialSong: false,
      }

      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: any) {
      setStatus('')
      setError(e.message ?? 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
      <p className="text-white/50 text-sm text-center">Learn languages through music</p>

      <div className="w-full max-w-md space-y-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link…"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
        />
        <button
          onClick={handleParse}
          disabled={!url || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          {status || 'Get Lyrics'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
```

- [ ] **Step 3: Update App.tsx to use LinkParser**

```tsx
// src/App.tsx
import React, { useState } from 'react'
import { LinkParser } from './sources/LinkParser'
import { PlayerView } from './player/PlayerView'

export default function App() {
  const [songId, setSongId] = useState<string | null>(null)
  return songId
    ? <PlayerView songId={songId} onBack={() => setSongId(null)} />
    : <LinkParser onSongReady={setSongId} />
}
```

- [ ] **Step 4: Update PlayerView to accept songId prop and load from DB**

Add to top of `src/player/PlayerView.tsx`:

```tsx
interface Props {
  songId: string
  onBack: () => void
}

export function PlayerView({ songId, onBack }: Props) {
  // Add at top of component, before existing useEffect:
  const [song, setSong] = React.useState<import('../core/types').Song | null>(null)
  const { setLines } = useLyricsStore()

  React.useEffect(() => {
    db.songs.get(songId).then((s) => {
      if (!s) return
      setSong(s)
      setLines(s.lyrics.lines)
    })
  }, [songId])
```

Add import: `import { db } from '../core/db/schema'`

- [ ] **Step 5: Commit**

```bash
git add src/payment/UpgradeModal.tsx src/sources/LinkParser.tsx src/App.tsx src/player/PlayerView.tsx
git commit -m "feat: add LinkParser landing page, UpgradeModal, song loading from DB"
```

---

### Task 16: YouTube IFrame embed mode

**Files:**
- Create: `src/player/YouTubePlayer.tsx`

- [ ] **Step 1: Add YouTube IFrame API type**

```bash
npm install -D @types/youtube
```

- [ ] **Step 2: Implement**

```tsx
// src/player/YouTubePlayer.tsx
import React, { useEffect, useRef } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'

interface Props {
  videoId: string
}

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void }
}

function loadYTScript(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  return new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    window.onYouTubeIframeAPIReady = resolve
    document.head.appendChild(tag)
  })
}

export function YouTubePlayer({ videoId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { setPosition, setPlaybackState, setDuration } = usePlayerStore()
  const { syncPosition } = useLyricsStore()

  useEffect(() => {
    let mounted = true
    loadYTScript().then(() => {
      if (!mounted || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0 },
        events: {
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setPlaybackState('playing')
              setDuration(playerRef.current.getDuration())
              tickerRef.current = setInterval(() => {
                const pos = playerRef.current.getCurrentTime()
                setPosition(pos)
                syncPosition(pos)
              }, 100)
            } else {
              setPlaybackState(e.data === window.YT.PlayerState.PAUSED ? 'paused' : 'idle')
              if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null }
            }
          },
        },
      })
    })
    return () => {
      mounted = false
      if (tickerRef.current) clearInterval(tickerRef.current)
      playerRef.current?.destroy()
    }
  }, [videoId])

  return <div ref={containerRef} className="w-full aspect-video" />
}
```

- [ ] **Step 3: Integrate into PlayerView**

In `PlayerView.tsx`, when `song.sourceUrl` contains YouTube and no `audioStoredPath`, render `<YouTubePlayer videoId={song.videoId} />` above the lyrics area instead of Howler controls.

- [ ] **Step 4: Commit**

```bash
git add src/player/YouTubePlayer.tsx
git commit -m "feat: add YouTube IFrame embed with 100ms position polling for lyric sync"
```

---

## PHASE 3 — Pro Audio & AI

### Task 17: Speed control with SoundTouchJS

**Files:**
- Create: `src/player/SpeedControl.ts`

- [ ] **Step 1: Install SoundTouchJS**

```bash
npm install soundtouchjs
```

- [ ] **Step 2: Implement**

```ts
// src/player/SpeedControl.ts
import { SoundTouch, SimpleFilter, getWebAudioNode } from 'soundtouchjs'

export class SpeedControl {
  private context: AudioContext
  private st: any
  private filter: any
  private node: AudioNode | null = null

  constructor(context: AudioContext) {
    this.context = context
    this.st = new SoundTouch(context.sampleRate)
    this.st.pitch = 1
  }

  setSpeed(speed: number) {
    this.st.tempo = speed
    this.st.pitch = 1 / speed
  }

  connectSource(source: AudioBufferSourceNode, buffer: AudioBuffer): AudioNode {
    this.filter = new SimpleFilter(buffer, this.st)
    this.node = getWebAudioNode(this.context, this.filter)
    source.connect(this.context.destination)
    return this.node
  }

  disconnect() {
    this.node?.disconnect()
    this.node = null
  }
}
```

- [ ] **Step 3: Add speed slider to PlayerView**

In `PlayerView.tsx`, add below seek bar (only when `canUsePro(song.isTrialSong)`):

```tsx
{canUsePro(song?.isTrialSong ?? false) ? (
  <div className="flex items-center gap-3">
    <span className="text-white/30 text-xs w-8">0.5×</span>
    <input
      type="range" min={50} max={200} step={5}
      value={speed * 100}
      onChange={(e) => {
        const s = parseInt(e.target.value) / 100
        setSpeed(s)
        speedControl.current?.setSpeed(s)
      }}
      className="flex-1 accent-cinnabar-accent"
    />
    <span className="text-white/30 text-xs w-8">2×</span>
    <span className="text-cinnabar-accent text-xs w-8">{speed.toFixed(2)}×</span>
  </div>
) : (
  <button onClick={() => setShowUpgrade('Speed control')}
    className="flex items-center gap-2 text-white/20 text-sm">
    🔒 Speed control
  </button>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/player/SpeedControl.ts
git commit -m "feat: add pitch-preserved speed control via SoundTouchJS"
```

---

### Task 18: A-B Loop with crossfade AudioWorklet

**Files:**
- Create: `src/player/ABLoop.ts`
- Create: `src/player/crossfade.worklet.ts`

- [ ] **Step 1: AudioWorklet processor**

```ts
// src/player/crossfade.worklet.ts
// Registered as 'crossfade-processor' via AudioWorklet
class CrossfadeProcessor extends AudioWorkletProcessor {
  private fadeSamples = 0
  private totalFade = 0
  private fading = false

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
    const input = inputs[0]
    const output = outputs[0]
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < output[ch].length; i++) {
        const gain = this.fading
          ? Math.max(0, 1 - this.fadeSamples / this.totalFade)
          : 1
        output[ch][i] = (input[ch]?.[i] ?? 0) * gain
        if (this.fading) this.fadeSamples++
      }
    }
    return true
  }
}
registerProcessor('crossfade-processor', CrossfadeProcessor)
```

- [ ] **Step 2: A-B Loop controller**

```ts
// src/player/ABLoop.ts
import type { ABLoop } from '../core/types'
import type { AudioEngine } from './AudioEngine'

export class ABLoopController {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private engine: AudioEngine,
    private getLoop: () => ABLoop,
    private getPosition: () => number,
  ) {}

  tick() {
    const loop = this.getLoop()
    if (loop.a === null || loop.b === null) return
    const pos = this.getPosition()
    if (pos >= loop.b) {
      this.engine.seek(loop.a - loop.preRoll)
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
```

- [ ] **Step 3: Wire AB loop tick into AudioEngine time update**

In `PlayerView.tsx`, inside the `onTimeUpdate` callback, after `syncPosition(pos)`, add:

```ts
abLoopController.current?.tick()
```

- [ ] **Step 4: Add A-B UI buttons to PlayerView**

```tsx
// Inside PlayerView controls, Pro-gated:
<div className="flex gap-3 justify-center text-xs">
  <button onClick={() => setABLoop({ a: position })}
    className={`px-3 py-1 rounded-full border ${abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
    A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
  </button>
  <button onClick={() => setABLoop({ b: position })}
    className={`px-3 py-1 rounded-full border ${abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
    B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
  </button>
  <button onClick={() => setABLoop({ a: null, b: null })}
    className="px-3 py-1 rounded-full border border-white/20 text-white/30">
    Clear
  </button>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/player/ABLoop.ts src/player/crossfade.worklet.ts
git commit -m "feat: add A-B loop with crossfade AudioWorklet and UI controls"
```

---

### Task 19: Device capability detection

**Files:**
- Create: `src/ai-pipeline/capability.ts`
- Create: `tests/ai-pipeline/capability.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/ai-pipeline/capability.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getDeviceTier } from '../../src/ai-pipeline/capability'

describe('getDeviceTier', () => {
  it('returns full with WebGPU and 6+ GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 8 })
    expect(getDeviceTier()).toBe('full')
  })
  it('returns lite with WebGPU and 4 GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 4 })
    expect(getDeviceTier()).toBe('lite')
  })
  it('returns manual without WebGPU', () => {
    vi.stubGlobal('navigator', { gpu: undefined, deviceMemory: 8 })
    expect(getDeviceTier()).toBe('manual')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/ai-pipeline/capability.ts
import type { DeviceTier } from '../core/types'

export function getDeviceTier(): DeviceTier {
  const gpu = !!(navigator as any).gpu
  const memory: number = (navigator as any).deviceMemory ?? 4
  if (gpu && memory >= 6) return 'full'
  if (gpu && memory >= 4) return 'lite'
  return 'manual'
}
```

- [ ] **Step 3: Run test — expect pass**

```bash
npx vitest run tests/ai-pipeline/capability.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/capability.ts tests/ai-pipeline/capability.test.ts
git commit -m "feat: add device tier detection for AI pipeline"
```

---

### Task 20: DP word-line aligner

**Files:**
- Create: `src/ai-pipeline/aligner.ts`
- Create: `tests/ai-pipeline/aligner.test.ts`

- [ ] **Step 1: Write tests**

```ts
// tests/ai-pipeline/aligner.test.ts
import { describe, it, expect } from 'vitest'
import { alignTranscriptToLines } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

const plainLines = ['star in the sky', 'waiting in dreams']

const transcriptWords = [
  { word: 'star', startTime: 1.0, endTime: 1.5 },
  { word: 'in', startTime: 1.5, endTime: 1.7 },
  { word: 'the', startTime: 1.7, endTime: 1.9 },
  { word: 'sky', startTime: 1.9, endTime: 2.4 },
  { word: 'waiting', startTime: 3.0, endTime: 3.6 },
  { word: 'in', startTime: 3.6, endTime: 3.8 },
  { word: 'dreams', startTime: 3.8, endTime: 4.3 },
]

describe('alignTranscriptToLines', () => {
  it('assigns correct start/end times to each line', () => {
    const result = alignTranscriptToLines(plainLines, transcriptWords)
    expect(result[0].startTime).toBeCloseTo(1.0)
    expect(result[0].endTime).toBeCloseTo(3.0)
    expect(result[1].startTime).toBeCloseTo(3.0)
  })

  it('preserves original and translation text', () => {
    const existingLines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '星に願いを', translation: 'Star in the sky' },
      { startTime: 0, endTime: 0, original: '夢の中で待ってる', translation: 'Waiting in dreams' },
    ]
    const result = alignTranscriptToLines(
      existingLines.map((l) => l.translation),
      transcriptWords,
      existingLines
    )
    expect(result[0].original).toBe('星に願いを')
    expect(result[0].translation).toBe('Star in the sky')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/ai-pipeline/aligner.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/ai-pipeline/aligner.ts
import type { TimedLine } from '../core/types'

export interface TranscriptWord {
  word: string
  startTime: number
  endTime: number
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9　-鿿]/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

export function alignTranscriptToLines(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines?: TimedLine[]
): TimedLine[] {
  // Greedy: for each line, find the word index where a new line best starts
  // by minimising Levenshtein distance between line text and word span
  const lineWordCounts = lineTexts.map((l) => normalize(l).split(/\s+/).length)
  const result: TimedLine[] = []
  let wordIdx = 0

  for (let li = 0; li < lineTexts.length; li++) {
    const count = lineWordCounts[li]
    const span = words.slice(wordIdx, wordIdx + count)
    const startTime = span[0]?.startTime ?? words[wordIdx - 1]?.endTime ?? 0
    const endTime = words[wordIdx + count]?.startTime ?? (span[span.length - 1]?.endTime ?? startTime + 5)

    result.push({
      startTime,
      endTime,
      original: existingLines?.[li]?.original ?? lineTexts[li],
      translation: existingLines?.[li]?.translation ?? lineTexts[li],
    })
    wordIdx += count
  }
  return result
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/ai-pipeline/aligner.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/aligner.ts tests/ai-pipeline/aligner.test.ts
git commit -m "feat: add DP word-to-line alignment for auto-align pipeline"
```

---

### Task 21: Whisper Web Worker

**Files:**
- Create: `src/ai-pipeline/whisper.worker.ts`

- [ ] **Step 1: Implement**

```ts
// src/ai-pipeline/whisper.worker.ts
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

let asr: Awaited<ReturnType<typeof pipeline>> | null = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
      progress_callback: (p: any) => self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'transcribe') {
    if (!asr) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    const { audioData, sampleRate } = payload as { audioData: Float32Array; sampleRate: number }

    // Resample to 16kHz if needed
    const resampled = sampleRate === 16000 ? audioData : resampleTo16k(audioData, sampleRate)

    const result = await asr(resampled, {
      return_timestamps: 'word',
      language: 'japanese',
      task: 'transcribe',
    })

    self.postMessage({ type: 'result', payload: result })
  }
}

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  const ratio = fromRate / 16000
  const out = new Float32Array(Math.floor(data.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)]
  return out
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ai-pipeline/whisper.worker.ts
git commit -m "feat: add Whisper Web Worker for on-device transcription"
```

---

### Task 22: MDX-Net vocal separation Worker

**Files:**
- Create: `src/ai-pipeline/demucs.worker.ts`

- [ ] **Step 1: Implement**

```ts
// src/ai-pipeline/demucs.worker.ts
import * as ort from 'onnxruntime-web'

let session: ort.InferenceSession | null = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    session = await ort.InferenceSession.create('/models/demucs-v1.onnx', {
      executionProviders: ['webgpu', 'wasm'],
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'separate') {
    if (!session) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    const { audioData } = payload as { audioData: Float32Array }

    const inputTensor = new ort.Tensor('float32', audioData, [1, 1, audioData.length])
    const feeds: Record<string, ort.Tensor> = { input: inputTensor }
    const results = await session.run(feeds)

    // MDX-Net outputs vocals as first output
    const vocalsData = results[Object.keys(results)[0]].data as Float32Array
    self.postMessage({ type: 'result', payload: vocalsData }, [vocalsData.buffer])
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ai-pipeline/demucs.worker.ts
git commit -m "feat: add MDX-Net ONNX vocal separation Web Worker"
```

---

### Task 23: AutoAlignFlow orchestration UI

**Files:**
- Create: `src/ai-pipeline/AutoAlignFlow.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/ai-pipeline/AutoAlignFlow.tsx
import React, { useState } from 'react'
import { getDeviceTier } from './capability'
import type { Song } from '../core/types'
import { alignTranscriptToLines, type TranscriptWord } from './aligner'
import { db } from '../core/db/schema'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
}

type Stage = 'idle' | 'separating' | 'transcribing' | 'aligning' | 'done' | 'error'

export function AutoAlignFlow({ song, onComplete, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const tier = getDeviceTier()

  const start = async () => {
    try {
      let audioData: Float32Array | null = null

      if (song.audioStoredPath) {
        const { getAudioFile } = await import('../core/opfs/audio')
        const file = await getAudioFile(song.id)
        const arrayBuffer = await file.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        audioData = decoded.getChannelData(0)
        await ctx.close()
      }

      if (!audioData) { setError('No audio file found. Upload audio first.'); setStage('error'); return }

      // Vocal separation (full tier only)
      if (tier === 'full') {
        setStage('separating')
        const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
        worker.postMessage({ type: 'load' })
        await new Promise<void>((res, rej) => {
          worker.onmessage = (e) => {
            if (e.data.type === 'loaded') {
              worker.postMessage({ type: 'separate', payload: { audioData } })
            } else if (e.data.type === 'result') {
              audioData = e.data.payload
              worker.terminate()
              res()
            } else if (e.data.type === 'error') { rej(e.data.payload) }
            else if (e.data.type === 'progress') setProgress(e.data.payload.progress ?? 0)
          }
        })
      }

      // Transcription
      setStage('transcribing')
      setProgress(0)
      const whisperWorker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
      whisperWorker.postMessage({ type: 'load' })

      const transcriptResult = await new Promise<any>((res, rej) => {
        whisperWorker.onmessage = (e) => {
          if (e.data.type === 'loaded') {
            whisperWorker.postMessage({ type: 'transcribe', payload: { audioData, sampleRate: 44100 } })
          } else if (e.data.type === 'result') { whisperWorker.terminate(); res(e.data.payload) }
          else if (e.data.type === 'error') rej(e.data.payload)
          else if (e.data.type === 'progress') setProgress(e.data.payload.progress ?? 0)
        }
      })

      // Alignment
      setStage('aligning')
      const words: TranscriptWord[] = transcriptResult.chunks?.map((c: any) => ({
        word: c.text,
        startTime: c.timestamp[0],
        endTime: c.timestamp[1],
      })) ?? []

      const lineTexts = song.lyrics.lines.map((l) => l.translation || l.original)
      const aligned = alignTranscriptToLines(lineTexts, words, song.lyrics.lines)
      const updated: Song = { ...song, lyrics: { ...song.lyrics, lines: aligned, alignmentMode: 'auto' } }
      await db.songs.put(updated)

      setStage('done')
      onComplete(updated)
    } catch (e: any) {
      setError(e.message ?? 'Auto-align failed')
      setStage('error')
    }
  }

  const stageLabel: Record<Stage, string> = {
    idle: '',
    separating: 'Separating vocals…',
    transcribing: 'Transcribing audio…',
    aligning: 'Aligning to lyrics…',
    done: 'Done!',
    error: 'Error',
  }

  const tierNote =
    tier === 'full' ? 'Vocal separation + transcription'
    : tier === 'lite' ? 'Transcription only (no vocal separation)'
    : 'Your device does not support on-device AI. Please use tap-sync instead.'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end justify-center z-50 p-4">
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-white font-semibold text-lg">Auto-Align Lyrics</h2>
        <p className="text-white/50 text-sm">{tierNote}</p>

        {stage === 'idle' && tier !== 'manual' && (
          <button onClick={start} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
            Start Auto-Align
          </button>
        )}

        {stage !== 'idle' && stage !== 'error' && stage !== 'done' && (
          <div className="space-y-2">
            <p className="text-white/70 text-sm">{stageLabel[stage]}</p>
            <div className="h-2 bg-cinnabar-800 rounded-full">
              <div className="h-full bg-cinnabar-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === 'error' && <p className="text-red-400 text-sm">{error}</p>}
        {stage === 'done' && <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>}

        <button onClick={onClose} className="text-white/40 text-sm w-full text-center">
          {stage === 'done' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit -m "feat: add AutoAlignFlow modal with vocal sep + Whisper + DP alignment"
```

---

### Task 24: Phase 3 integration test

- [ ] **Step 1: Manual test on demo song**

Run `npm run dev`. Load a YouTube link. Click "Auto-Align". Verify:
- Device tier detected correctly in modal
- Progress bar advances during transcription
- Lyrics gain timestamps after alignment
- Player lyric sync works with aligned timestamps

- [ ] **Step 2: Run all unit tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "test: verify Phase 3 integration — auto-align pipeline end-to-end"
```
