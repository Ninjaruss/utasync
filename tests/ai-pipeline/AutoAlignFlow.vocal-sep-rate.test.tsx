import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'

/**
 * Regression: Demucs returns vocals at its model rate (44100), NOT the decode
 * rate. A 48kHz AudioContext decode + vocal separation used to keep the stale
 * 48000 rate, so every Whisper timestamp came back uniformly ~8.8% early —
 * the entire song desynced ("all lines off by a few seconds").
 */

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
}))

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: {
    vocalSeparationEnabled: boolean
    modelDownloadConsented: boolean
    setVocalSeparationEnabled: () => void
    setModelDownloadConsented: (v: boolean) => void
  }) => unknown) =>
    // Consent granted so autoStart proceeds straight into the run under test.
    selector({
      vocalSeparationEnabled: true,
      modelDownloadConsented: true,
      setVocalSeparationEnabled: vi.fn(),
      setModelDownloadConsented: vi.fn(),
    }),
}))

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new Blob([new ArrayBuffer(8)], { type: 'audio/wav' })),
}))

// Decode yields 48kHz audio (common Firefox AudioContext rate).
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => ({ data: new Float32Array(48000), sampleRate: 48000 })),
}))

const separatedVocals = new Float32Array(44100)
vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real,
    isDemucsModelAvailable: vi.fn(async () => true),
    refreshDemucsModelAvailability: vi.fn(async () => true),
    separateVocals: vi.fn(async () => separatedVocals),
  }
})

const transcribeAudio = vi.fn(async (_audio: Float32Array, _rate: number, opts?: { onModelLoaded?: () => void }) => {
  opts?.onModelLoaded?.()
  return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
})

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))

const song: Song = {
  id: 's1',
  title: 'T',
  artist: 'A',
  sources: [],
  audioStoredPath: '/audio/s1',
  lyrics: {
    lines: [{ startTime: 0, endTime: 0, original: 'hello', translation: '' }],
    sourceLanguage: 'en',
    translationLanguage: 'en',
  },
  syncState: 'unsynced',
  createdAt: new Date(),
}

beforeEach(async () => {
  await db.songs.clear()
  transcribeAudio.mockClear()
})

describe('AutoAlignFlow vocal separation sample rate', () => {
  it('feeds Whisper the separated audio at the Demucs output rate, not the decode rate', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 10_000 })

    expect(transcribeAudio).toHaveBeenCalled()
    const [audioArg, rateArg] = transcribeAudio.mock.calls[0]
    expect(audioArg).toBe(separatedVocals)
    expect(rateArg).toBe(44100)
  })
})
