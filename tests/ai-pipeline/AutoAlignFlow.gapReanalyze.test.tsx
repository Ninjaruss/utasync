import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import type { ReanalyzeGapsArgs } from '../../src/ai-pipeline/gapReanalyze'
import { GAP_RECOVERY_VERSION } from '../../src/ai-pipeline/gapRecovery'

// This suite tests the AutoAlignFlow GLUE around reanalyzeGaps — that it is wired
// in after the main align, that the injected transcribeSlice slices audioData and
// offsets slice-relative words to absolute time, and that the gap pass's returned
// refined/transcriptWords are persisted. The loop itself is unit-tested against a
// mock in gapReanalyze.test.ts; here reanalyzeGaps is mocked so the glue is
// isolated from refine internals.

const deviceTier = vi.hoisted(() => ({ current: 'lite' as 'lite' | 'full' | 'manual' }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => deviceTier.current,
  canUseVocalSeparation: () => false,
}))

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: { vocalSeparationEnabled: boolean; setVocalSeparationEnabled: () => void }) => unknown) =>
    selector({ vocalSeparationEnabled: false, setVocalSeparationEnabled: vi.fn() }),
}))

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new Blob([new ArrayBuffer(8)], { type: 'audio/wav' })),
}))

// A recognizable ramp so the slice offset math is observable: sample i has value i.
const SR = 100
class MockAudioContext {
  async decodeAudioData() {
    const data = new Float32Array(2000)
    for (let i = 0; i < data.length; i++) data[i] = i
    return { numberOfChannels: 1, length: data.length, sampleRate: SR, getChannelData: () => data }
  }
  async close() {}
}
vi.stubGlobal('AudioContext', MockAudioContext)

// Main transcript: one chunk covering [1,2]s (slice-relative timestamps would be
// re-emitted by the slice call below).
const transcribeAudio = vi.fn(async (_audio: Float32Array, _rate: number, opts?: {
  onModelLoaded?: () => void
}) => {
  opts?.onModelLoaded?.()
  return { chunks: [{ text: 'alpha', timestamp: [1, 2] as [number, number] }] }
})

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))

vi.mock('../../src/ai-pipeline/aligner', () => ({
  alignLyrics: vi.fn(() => ({
    lines: [{ startTime: 0, endTime: 1, original: 'alpha', translation: '' }],
    mode: 'content',
    confidence: 0.9,
    anchorSources: ['lcs'],
  })),
  sanitizeTranscript: vi.fn((words: { word: string }[]) => words),
  lineWeight: vi.fn(() => 1),
  LOW_CONFIDENCE_WARN_THRESHOLD: 0.7,
}))

// Capture the args reanalyzeGaps is called with, and drive the injected
// transcribeSlice so the glue (slice + offset) runs for real.
const reanalyzeArgs = vi.hoisted(() => ({ current: null as ReanalyzeGapsArgs | null }))
const sliceWords = vi.hoisted(() => ({ current: null as unknown }))
const reanalyzeGaps = vi.fn(async (args: ReanalyzeGapsArgs) => {
  reanalyzeArgs.current = args
  // Exercise the injected slice closure for the window [3,5]s, English.
  sliceWords.current = await args.transcribeSlice(3, 5, 'en')
  // Return a refined + transcript the flow must persist (distinct marker).
  return {
    refined: {
      ...args.refined,
      lines: [{ startTime: 9, endTime: 10, original: 'GAP-FILLED', translation: '' }],
    },
    transcriptWords: [{ word: 'gapword', startTime: 9, endTime: 10 }],
    filledCount: 1,
  }
})

vi.mock('../../src/ai-pipeline/gapReanalyze', () => ({
  reanalyzeGaps: (args: ReanalyzeGapsArgs) => reanalyzeGaps(args),
  // constants are unused by the flow beyond the mock, but keep the shape.
  MAX_GAP_PASSES: 2,
  MAX_HOLES_PER_PASS: 4,
  MAX_SLICE_S: 30,
}))

const song: Song = {
  id: 'g1',
  title: 'T',
  artist: 'A',
  sources: [],
  audioStoredPath: '/audio/g1',
  lyrics: {
    lines: [{ startTime: 0, endTime: 0, original: 'alpha', translation: '' }],
    sourceLanguage: 'en',
    translationLanguage: 'en',
  },
  syncState: 'unsynced',
  createdAt: new Date(),
}

beforeEach(async () => {
  await db.songs.clear()
  transcribeAudio.mockClear()
  reanalyzeGaps.mockClear()
  reanalyzeArgs.current = null
  sliceWords.current = null
  deviceTier.current = 'lite'
})

describe('AutoAlignFlow gap re-transcription wiring', () => {
  it('invokes reanalyzeGaps after the main align with the sheet rows and language', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(reanalyzeGaps).toHaveBeenCalledTimes(1)
    const args = reanalyzeArgs.current!
    expect(args.alignmentLanguage).toBe('en')
    expect(args.sheetRows.length).toBe(1)
    expect(typeof args.transcribeSlice).toBe('function')
    expect(typeof args.isCancelled).toBe('function')
  })

  it('the injected transcribeSlice slices audioData and offsets words to absolute time', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    // The main pass + one slice both go through transcribeAudio.
    expect(transcribeAudio.mock.calls.length).toBeGreaterThanOrEqual(2)
    // The slice call received a subarray starting at floor(3 * 100) = sample 300,
    // whose ramp value is 300 (proves the correct window was sliced).
    const sliceCall = transcribeAudio.mock.calls[transcribeAudio.mock.calls.length - 1]
    const sliceBuf = sliceCall[0]
    expect(sliceBuf[0]).toBe(300)
    expect(sliceBuf.length).toBe(200) // floor(5*100) - floor(3*100)
    // Returned words were offset by t0 = 3s: chunk [1,2] → [4,5].
    const words = sliceWords.current as { word: string; startTime: number; endTime: number }[]
    expect(words).toEqual([{ word: 'alpha', startTime: 4, endTime: 5 }])
  })

  it('persists the refined + transcript returned by the gap pass', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = await db.songs.get(song.id)
    // The gap pass's returned line + transcript won over the pre-gap alignment.
    expect(saved?.lyrics.lines[0]?.original).toBe('GAP-FILLED')
    expect(saved?.lyrics.transcriptWords).toEqual([{ word: 'gapword', startTime: 9, endTime: 10 }])
  })

  it('stamps gapRecoveryVersion so a fresh align never re-runs stored-song auto-recovery', async () => {
    // This flow already ran its own gap pass; the stamp guards against a leftover
    // unrecoverable hole tripping shouldAutoRecoverGaps (re-decode + Whisper) on reopen.
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = await db.songs.get(song.id)
    expect(saved?.lyrics.gapRecoveryVersion).toBe(GAP_RECOVERY_VERSION)
  })
})
