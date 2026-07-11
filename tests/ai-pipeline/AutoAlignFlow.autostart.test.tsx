import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'

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
  deviceTier.current = 'lite'
})

describe('AutoAlignFlow autoStart', () => {
  it('skips the idle Start button and begins alignment when autoStart is set', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /start auto-align/i })).toBeNull()
    expect(screen.getByText(/preparing audio/i)).toBeTruthy()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalled()
    const saved = await db.songs.get(song.id)
    expect(saved?.lyrics.alignmentMode).toBe('auto')
    expect(saved?.syncState).toBe('synced')
  })

  it('shows Start Auto-Align when autoStart is false', () => {
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start auto-align/i })).toBeTruthy()
  })

  it('discards results that resolve after the user cancels mid-run', async () => {
    let resolveTranscribe!: (v: { chunks: { text: string; timestamp: [number, number] }[] }) => void
    transcribeAudio.mockImplementationOnce((_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      return new Promise((resolve) => { resolveTranscribe = resolve })
    })

    const onComplete = vi.fn()
    const onClose = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={onClose} />)

    await waitFor(() => expect(transcribeAudio).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(onClose).toHaveBeenCalled()

    resolveTranscribe({ chunks: [{ text: 'hello', timestamp: [0, 1] }] })
    await new Promise((r) => setTimeout(r, 50))

    expect(onComplete).not.toHaveBeenCalled()
    expect(await db.songs.get(song.id)).toBeUndefined()
  })
})

describe('AutoAlignFlow high accuracy toggle', () => {
  it('renders the toggle on full tier and forces highAccuracy + segment mode when enabled', async () => {
    deviceTier.current = 'full'
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} onComplete={onComplete} onClose={vi.fn()} />)

    const toggle = screen.getByRole('checkbox', { name: /high accuracy/i })
    fireEvent.click(toggle)

    fireEvent.click(screen.getByRole('button', { name: /start auto-align/i }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ highAccuracy: true, timestampMode: 'segment' }),
    )
  })

  it('does not render the toggle or enable highAccuracy on manual tier', async () => {
    deviceTier.current = 'manual'
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} onComplete={onComplete} onClose={vi.fn()} />)

    expect(screen.queryByRole('checkbox', { name: /high accuracy/i })).toBeNull()
  })
})
