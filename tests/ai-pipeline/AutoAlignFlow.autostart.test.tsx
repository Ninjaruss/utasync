import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'lite' }))

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
}))

vi.mock('../../src/ai-pipeline/aligner', () => ({
  alignLyrics: vi.fn(() => ({
    lines: [{ startTime: 0, endTime: 1, original: 'hello', translation: '' }],
    mode: 'matched',
    confidence: 0.9,
  })),
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
  isTrialSong: false,
}

beforeEach(async () => {
  await db.songs.clear()
  transcribeAudio.mockClear()
})

describe('AutoAlignFlow autoStart', () => {
  it('skips the idle Start button and begins alignment when autoStart is set', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /start auto-align/i })).toBeNull()
    expect(screen.getByText(/preparing audio/i)).toBeTruthy()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalled()
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
