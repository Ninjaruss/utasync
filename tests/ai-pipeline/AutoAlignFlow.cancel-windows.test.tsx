import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import { SeparationAbandonedError } from '../../src/ai-pipeline/demucsSeparator'

/**
 * Three flow-control defects, all reachable from the align dialog itself:
 *
 *  1. Cancel during "Preparing audio" did not cancel. Nothing re-checked the flag
 *     between the decode and the transcription, so Stop still loaded the model and
 *     transcribed the whole song (minutes of CPU) before discarding it — after a
 *     dialog that promises "Stopping now discards all progress".
 *  2. An ETA prompt the user left open stayed rendered over every later stage after
 *     the separation it asked about had already been abandoned.
 *  3. A failure during the model DOWNLOAD was retried under "likely out of memory",
 *     which sends the user off to close tabs for a connection problem.
 */

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
  probeWebGPUAdapter: async () => true,
}))

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: {
    vocalSeparationEnabled: boolean | null
    modelDownloadConsented: boolean
    setVocalSeparationEnabled: () => void
    setModelDownloadConsented: (v: boolean) => void
  }) => unknown) =>
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

// A decode that only finishes when this spec lets it, so a Cancel can be issued
// while the flow is still in its 'preparing' stage.
let releaseDecode: () => void = () => {}
const decodeGate = new Promise<void>((resolve) => { releaseDecode = resolve })
const mixAudio = new Float32Array(48000)
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => {
    await decodeGate
    return { data: mixAudio, sampleRate: 48000 }
  }),
}))

/** Drives the ETA prompt without ever resolving it: the user simply ignores it. */
let etaPromptSeen = false
vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real,
    isDemucsModelAvailable: vi.fn(async () => true),
    refreshDemucsModelAvailability: vi.fn(async () => true),
    separateVocals: vi.fn(async (_audio: Float32Array, opts?: {
      onLongEstimate?: (projectedMs: number) => Promise<'skip' | 'continue'>
    }) => {
      // Above etaPromptThresholdMs → the flow raises the prompt.
      void opts?.onLongEstimate?.(45 * 60_000)
      etaPromptSeen = true
      // The run then dies on its own cap while the prompt is still unanswered.
      throw new SeparationAbandonedError('timeout', 'Vocal separation exceeded its time budget')
    }),
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
  cleanup()
  await db.songs.clear()
  transcribeAudio.mockClear()
  etaPromptSeen = false
})

describe('AutoAlignFlow cancellation windows', () => {
  it('stops without transcribing when Cancel lands during the decode', { timeout: 20_000 }, async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    // Stage is 'preparing' (the decode is parked). Stop → confirm.
    fireEvent.click(await screen.findByText('Cancel'))
    fireEvent.click(await screen.findByText('Stop'))

    // Let the decode finish: the run must notice the cancellation and bail BEFORE
    // paying for a model load + full-song transcription.
    releaseDecode()
    await waitFor(() => expect(screen.queryByText('Stop')).toBeNull())
    await new Promise((r) => setTimeout(r, 50))
    expect(transcribeAudio).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('AutoAlignFlow abandoned separation', () => {
  it('clears an unanswered ETA prompt when the separation is abandoned', { timeout: 20_000 }, async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    releaseDecode()

    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 15_000 })
    expect(etaPromptSeen).toBe(true)
    // The prompt's decision no longer exists — the run already fell back to the mix
    // and finished — so it must not be sitting over the done screen.
    expect(screen.queryByText('This will take a while')).toBeNull()
  })
})
