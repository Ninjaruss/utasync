import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'

// A browser back/refresh/tab-close silently kills a multi-minute align run — the
// in-app Cancel is confirmed via ConfirmDialog, but only a `beforeunload` handler
// can guard the browser's own escape routes. This suite pins that the guard is
// registered exactly while the flow is actively processing and removed on
// completion, error, and unmount (and never registered while idle).

const deviceTier = vi.hoisted(() => ({ current: 'lite' as 'lite' | 'full' | 'manual' }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => deviceTier.current,
  canUseVocalSeparation: () => false,
}))

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: {
    vocalSeparationEnabled: boolean
    modelDownloadConsented: boolean
    setVocalSeparationEnabled: () => void
    setModelDownloadConsented: (v: boolean) => void
  }) => unknown) =>
    // Consent already granted so the flow autostarts straight into processing —
    // this suite pins the beforeunload guard, not the first-run prompt.
    selector({
      vocalSeparationEnabled: false,
      modelDownloadConsented: true,
      setVocalSeparationEnabled: vi.fn(),
      setModelDownloadConsented: vi.fn(),
    }),
}))

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new Blob([new ArrayBuffer(8)], { type: 'audio/wav' })),
}))

class MockAudioContext {
  async decodeAudioData() {
    return { getChannelData: () => new Float32Array(100), sampleRate: 44100 }
  }
  async close() {}
}
vi.stubGlobal('AudioContext', MockAudioContext)

const transcribeAudio = vi.fn(async (_audio: Float32Array, _rate: number, opts?: {
  onModelLoaded?: () => void
}) => {
  opts?.onModelLoaded?.()
  return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
})

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))

vi.mock('../../src/ai-pipeline/aligner', () => ({
  alignLyrics: vi.fn(() => ({
    lines: [{ startTime: 0, endTime: 1, original: 'hello', translation: '' }],
    mode: 'content',
    confidence: 0.9,
    anchorSources: ['lcs'],
  })),
  sanitizeTranscript: vi.fn((words: { word: string }[]) => words),
  lineWeight: vi.fn(() => 1),
  LOW_CONFIDENCE_WARN_THRESHOLD: 0.7,
}))

const song: Song = {
  id: 'u1',
  title: 'T',
  artist: 'A',
  sources: [],
  audioStoredPath: '/audio/u1',
  lyrics: {
    lines: [{ startTime: 0, endTime: 0, original: 'hello', translation: '' }],
    sourceLanguage: 'en',
    translationLanguage: 'en',
  },
  syncState: 'unsynced',
  createdAt: new Date(),
}

let addSpy: ReturnType<typeof vi.spyOn>
let removeSpy: ReturnType<typeof vi.spyOn>

const beforeUnloadAdds = () => addSpy.mock.calls.filter(([type]) => type === 'beforeunload')
const beforeUnloadRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'beforeunload')

beforeEach(async () => {
  await db.songs.clear()
  transcribeAudio.mockClear()
  deviceTier.current = 'lite'
  addSpy = vi.spyOn(window, 'addEventListener')
  removeSpy = vi.spyOn(window, 'removeEventListener')
})

afterEach(() => {
  addSpy.mockRestore()
  removeSpy.mockRestore()
})

describe('AutoAlignFlow beforeunload guard', () => {
  it('registers beforeunload while processing and removes it once the run completes', async () => {
    let resolveTranscribe!: (v: { chunks: { text: string; timestamp: [number, number] }[] }) => void
    transcribeAudio.mockImplementationOnce((_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      return new Promise((resolve) => { resolveTranscribe = resolve })
    })

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(transcribeAudio).toHaveBeenCalled())
    // Guard is registered while the run is in flight and not yet removed.
    expect(beforeUnloadAdds().length).toBeGreaterThan(0)
    expect(beforeUnloadRemoves().length).toBeLessThan(beforeUnloadAdds().length)

    // The handler asks the browser to confirm leaving.
    const handler = beforeUnloadAdds()[0][1] as (e: Event) => void
    const evt = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    handler(evt as unknown as Event)
    expect(evt.preventDefault).toHaveBeenCalled()
    expect(evt.returnValue).toBe('')

    resolveTranscribe({ chunks: [{ text: 'hello', timestamp: [0, 1] }] })
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    // Done stage: every registration has been removed again.
    expect(beforeUnloadRemoves().length).toBe(beforeUnloadAdds().length)
  })

  it('removes the guard on unmount mid-run', async () => {
    transcribeAudio.mockImplementationOnce((_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      return new Promise(() => {}) // never resolves — stays processing
    })

    const { unmount } = render(
      <AutoAlignFlow song={song} autoStart onComplete={vi.fn()} onClose={vi.fn()} />,
    )
    await waitFor(() => expect(transcribeAudio).toHaveBeenCalled())
    expect(beforeUnloadAdds().length).toBeGreaterThan(0)

    unmount()
    expect(beforeUnloadRemoves().length).toBe(beforeUnloadAdds().length)
  })

  it('removes the guard when the run fails', async () => {
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error('Transcription cancelled') // non-recoverable: no retry
    })

    render(<AutoAlignFlow song={song} autoStart onComplete={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/transcription cancelled/i)).toBeTruthy())
    expect(beforeUnloadAdds().length).toBeGreaterThan(0)
    expect(beforeUnloadRemoves().length).toBe(beforeUnloadAdds().length)
  })

  it('does not register the guard while idle', () => {
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect(beforeUnloadAdds().length).toBe(0)
  })
})
