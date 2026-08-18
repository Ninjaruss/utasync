import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import { separateVocals, SeparationAbandonedError } from '../../src/ai-pipeline/demucsSeparator'
import { probeWebGPUAdapter } from '../../src/ai-pipeline/capability'

/**
 * A user reported auto-align sitting on "Separating vocals" for 50+ minutes.
 * Separation is now bounded, and every way it can give up must still land the
 * user on timed lyrics via the raw mix — never on a dead dialog.
 */

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
  hasWebGPU: () => true,
  // Delegates so a single test can answer "no adapter" without re-mocking.
  probeWebGPUAdapter: vi.fn(async () => true),
  resetWebGPUAdapterProbe: vi.fn(),
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

// Stable ref at a non-Demucs rate, so "we transcribed the mix" is provable.
const mixAudio = new Float32Array(48000)
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => ({ data: mixAudio, sampleRate: 48000 })),
}))

vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real,
    isDemucsModelAvailable: vi.fn(async () => true),
    refreshDemucsModelAvailability: vi.fn(async () => true),
    separateVocals: vi.fn(async () => new Float32Array(44100)),
  }
})

// Transcription parks on a gate so the in-flight status line (which only exists
// during the transcribing stage) is still on screen when we assert on it.
let releaseTranscribe: () => void = () => {}
let transcribeGate = Promise.resolve()
const transcribeMock = vi.fn(
  async (
    _audio: Float32Array,
    _rate: number,
    opts?: { onModelLoaded?: () => void },
  ) => {
    opts?.onModelLoaded?.()
    await transcribeGate
    return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
  },
)

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeMock>) => transcribeMock(...args),
  resetWhisperTranscriber: vi.fn(),
}))

const song: Song = {
  id: 'stall-song',
  title: 'Test',
  artist: 'Test',
  sources: [],
  audioStoredPath: '/audio/stall-song',
  lyrics: {
    lines: [{ startTime: 0, endTime: 0, original: 'hello', translation: '' }],
    sourceLanguage: 'en',
    translationLanguage: 'en',
  },
  syncState: 'unsynced',
  createdAt: new Date(),
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(probeWebGPUAdapter).mockResolvedValue(true)
  transcribeGate = new Promise<void>((resolve) => { releaseTranscribe = resolve })
  await db.songs.clear()
  await db.songs.put(song)
})

afterEach(() => {
  // Never leave the component awaiting a promise that will not settle.
  releaseTranscribe()
  cleanup()
})

describe('AutoAlignFlow — abandoned vocal separation', () => {
  // Every abandon reason routes into the same fallback the stem-quality guard
  // already uses, so alignment continues on the decoded mix.
  it.each([
    ['timeout' as const, /taking too long/i],
    ['stalled' as const, /stopped responding/i],
    ['skipped' as const, /skipped vocal isolation/i],
  ])('falls back to the raw mix when separation is %s', async (reason, copy) => {
    vi.mocked(separateVocals).mockRejectedValueOnce(
      new SeparationAbandonedError(reason, `separation ${reason}`),
    )

    const { findByText } = render(
      <AutoAlignFlow song={song} autoStart onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    // Transcription must still run — on the 48kHz decoded mix, not a 44.1k stem.
    await waitFor(() => expect(transcribeMock).toHaveBeenCalled())
    const [audioArg, rateArg] = transcribeMock.mock.calls[0]
    expect(audioArg).toBe(mixAudio)
    expect(rateArg).toBe(48000)

    expect(await findByText(copy)).toBeTruthy()
  })

  // A definitive "no WebGPU adapter" means separation would grind on WASM. The
  // user is asked before the model download, and declining skips separation
  // entirely rather than merely bounding it.
  it('asks before running on the CPU, and skips separation when declined', async () => {
    vi.mocked(probeWebGPUAdapter).mockResolvedValue(false)

    const { findByText, getByText } = render(
      <AutoAlignFlow song={song} autoStart onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(await findByText(/No GPU acceleration here/i)).toBeTruthy()
    expect(separateVocals).not.toHaveBeenCalled()

    fireEvent.click(getByText('Skip it'))

    await waitFor(() => expect(transcribeMock).toHaveBeenCalled())
    const [audioArg, rateArg] = transcribeMock.mock.calls[0]
    expect(audioArg).toBe(mixAudio)
    expect(rateArg).toBe(48000)
    expect(separateVocals).not.toHaveBeenCalled()
    expect(await findByText(/skipped vocal isolation/i)).toBeTruthy()
  })

  // Escape must back OUT of the expensive choice. useModalDialog maps Escape to
  // onCancel, so these two prompts deliberately put "Skip it" there and "Keep
  // going" on confirm — the inverse of the cancel dialog's arrangement. Get that
  // backwards and Escape silently commits the user to a CPU grind, which is the
  // very thing the original bug report was about.
  it('skips separation when the CPU warning is dismissed with Escape', async () => {
    vi.mocked(probeWebGPUAdapter).mockResolvedValue(false)

    const { findByText } = render(
      <AutoAlignFlow song={song} autoStart onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(await findByText(/No GPU acceleration here/i)).toBeTruthy()

    // Fired on document (capture) because that is where useModalDialog binds —
    // calling onCancel directly would prove nothing about the key binding.
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(transcribeMock).toHaveBeenCalled())
    expect(separateVocals).not.toHaveBeenCalled()
    expect(await findByText(/skipped vocal isolation/i)).toBeTruthy()
  })
})
