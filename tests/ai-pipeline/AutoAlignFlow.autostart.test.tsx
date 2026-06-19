import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
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

class FakeWhisperWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage(msg: { type: string }) {
    if (msg.type === 'load') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'loaded' } } as MessageEvent))
    } else if (msg.type === 'transcribe') {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'result',
            payload: { chunks: [{ text: 'hello', timestamp: [0, 1] }] },
          },
        } as MessageEvent),
      )
    }
  }
  terminate() {}
}

vi.stubGlobal(
  'Worker',
  vi.fn(function FakeWorker() {
    return new FakeWhisperWorker()
  }),
)

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
})

describe('AutoAlignFlow autoStart', () => {
  it('skips the idle Start button and begins alignment when autoStart is set', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /start auto-align/i })).toBeNull()
    expect(screen.getByText(/loading ai model/i)).toBeTruthy()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('shows Start Auto-Align when autoStart is false', () => {
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /start auto-align/i })).toBeTruthy()
  })
})
