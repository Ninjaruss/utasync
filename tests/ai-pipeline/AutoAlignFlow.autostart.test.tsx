import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import { isDemucsModelAvailable, refreshDemucsModelAvailability } from '../../src/ai-pipeline/demucsSeparator'

const deviceTier = vi.hoisted(() => ({ current: 'lite' as 'lite' | 'full' | 'manual' }))
const vocalSepSupported = vi.hoisted(() => ({ current: false }))
// First-run download consent flag. Defaults to already-consented so the existing
// specs autostart straight into alignment; the consent-gate spec flips it off.
const settings = vi.hoisted(() => ({ consented: true }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => deviceTier.current,
  canUseVocalSeparation: () => vocalSepSupported.current,
}))

// Only reached when vocalSepSupported is flipped on (the demucs-missing copy test).
vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real,
    isDemucsModelAvailable: vi.fn(async () => false),
    refreshDemucsModelAvailability: vi.fn(async () => false),
  }
})

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: {
    vocalSeparationEnabled: boolean
    modelDownloadConsented: boolean
    setVocalSeparationEnabled: () => void
    setModelDownloadConsented: (v: boolean) => void
  }) => unknown) =>
    selector({
      vocalSeparationEnabled: false,
      modelDownloadConsented: settings.consented,
      setVocalSeparationEnabled: vi.fn(),
      setModelDownloadConsented: (v: boolean) => { settings.consented = v },
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
  timestampMode?: 'word' | 'segment'
  highAccuracy?: boolean
  language?: 'ja' | 'en' | 'mixed'
}) => {
  opts?.onModelLoaded?.()
  return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
})

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))

vi.mock('../../src/ai-pipeline/mixedLanguageAlign', () => ({
  refineMixedLanguageAlignment: vi.fn((sheetRows: { original: string; translation: string }[]) => ({
    refined: {
      lines: sheetRows.map((r) => ({ ...r, startTime: 0, endTime: 1 })),
      phrases: [],
      report: { merged: 0, split: 0 },
      mode: 'content',
      confidence: 0.9,
      phraseLayout: 'sheet',
    },
    transcriptWords: [],
    pickedFrom: sheetRows.map(() => 'ja'),
  })),
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
  vocalSepSupported.current = false
  settings.consented = true
  vi.mocked(refreshDemucsModelAvailability).mockResolvedValue(false)
  vi.mocked(isDemucsModelAvailable).mockResolvedValue(false)
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

  it('defaults vocal isolation ON for a mixed-language song on a capable device', () => {
    deviceTier.current = 'full'
    vocalSepSupported.current = true
    vi.mocked(refreshDemucsModelAvailability).mockResolvedValue(true)
    vi.mocked(isDemucsModelAvailable).mockResolvedValue(true)
    const mixedSong: Song = {
      ...song,
      lyrics: {
        lines: [
          { startTime: 0, endTime: 0, original: '青空に溶けていく', translation: '' },
          { startTime: 0, endTime: 0, original: 'You make me so happy today', translation: '' },
          { startTime: 0, endTime: 0, original: '君の声が聞こえる', translation: '' },
          { startTime: 0, endTime: 0, original: 'Running through the endless night', translation: '' },
          { startTime: 0, endTime: 0, original: '光の中で踊りだす', translation: '' },
          { startTime: 0, endTime: 0, original: 'Everything I do for you now', translation: '' },
        ],
        sourceLanguage: 'ja',
        translationLanguage: 'en',
      },
    }
    render(<AutoAlignFlow song={mixedSong} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('checkbox', { name: /isolate vocals/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('leaves vocal isolation OFF by default for a single-language song', () => {
    deviceTier.current = 'full'
    vocalSepSupported.current = true
    vi.mocked(refreshDemucsModelAvailability).mockResolvedValue(true)
    vi.mocked(isDemucsModelAvailable).mockResolvedValue(true)
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('checkbox', { name: /isolate vocals/i }) as HTMLInputElement).checked).toBe(false)
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

  it('falls back from word to segment timestamps when the WASM worker crashes (OOM)', async () => {
    deviceTier.current = 'full' // short song on full tier defaults to word mode
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      expect(opts?.timestampMode).toBe('word')
      // What whisperTranscriber rejects with after describeWorkerError translation.
      throw new Error('The on-device speech model crashed (WASM error 1261431424) — this usually means the browser ran out of memory.')
    })

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    expect(transcribeAudio.mock.calls[1][2]?.timestampMode).toBe('segment')
    const saved = await db.songs.get(song.id)
    expect(saved?.syncState).toBe('synced')
  })

  it('does not retry after a user cancellation', async () => {
    deviceTier.current = 'full'
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error('Transcription cancelled')
    })

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/transcription cancelled/i)).toBeTruthy())
    expect(transcribeAudio).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('AutoAlignFlow mixed-language two-pass', () => {
  const mixedSong: Song = {
    ...song,
    id: 's2',
    lyrics: {
      lines: [
        { startTime: 0, endTime: 0, original: '君のいない夜に', translation: '' },
        { startTime: 0, endTime: 0, original: '星が降る街で', translation: '' },
        { startTime: 0, endTime: 0, original: '声を聞かせて', translation: '' },
        { startTime: 0, endTime: 0, original: 'stranger in the night', translation: '' },
        { startTime: 0, endTime: 0, original: 'heaven knows my name', translation: '' },
        { startTime: 0, endTime: 0, original: 'take me far away', translation: '' },
      ],
      sourceLanguage: 'ja',
      translationLanguage: 'en',
    },
  }

  it('always transcribes the EN pass at segment granularity, even in word mode', async () => {
    deviceTier.current = 'full' // short song on full tier defaults to word mode
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={mixedSong} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    const jaOpts = transcribeAudio.mock.calls[0][2]
    const enOpts = transcribeAudio.mock.calls[1][2]
    expect(jaOpts?.language).toBe('ja')
    expect(jaOpts?.timestampMode).toBe('word') // JA pass keeps the user's mode
    expect(enOpts?.language).toBe('en')
    // Whisper's forced-EN word timestamps on sung vocals are unreliable and the
    // merge is line-level, so the EN pass must always run at segment granularity.
    expect(enOpts?.timestampMode).toBe('segment')
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

describe('AutoAlignFlow crash-downgrade retry visibility', () => {
  const RECOVERABLE_CRASH =
    'The on-device speech model crashed (WASM error 1261431424) — this usually means the browser ran out of memory.'

  it('shows the downgrade notice while the segment retry runs, then clears it', async () => {
    deviceTier.current = 'full' // short song on full tier defaults to word mode
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error(RECOVERABLE_CRASH)
    })
    let resolveRetry!: (v: { chunks: { text: string; timestamp: [number, number] }[] }) => void
    transcribeAudio.mockImplementationOnce((_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      return new Promise((resolve) => { resolveRetry = resolve })
    })

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    // Without the notice the bar just snaps to 0 with no explanation.
    await waitFor(() =>
      expect(screen.getByText(/word-level pass failed.*retrying with segment timestamps/i)).toBeTruthy(),
    )

    resolveRetry({ chunks: [{ text: 'hello', timestamp: [0, 1] }] })
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(screen.queryByText(/retrying with segment timestamps/i)).toBeNull()
    expect(transcribeAudio.mock.calls[1][2]?.timestampMode).toBe('segment')
  })

  it('flips back to the loading stage on the high-accuracy fallback so the model load is visible', async () => {
    deviceTier.current = 'full'
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error(RECOVERABLE_CRASH)
    })
    // The fallback (standard) model is still loading: hold the retry open and
    // do NOT announce the model yet.
    let finishRetry!: () => void
    transcribeAudio.mockImplementationOnce((_audio, _rate, opts) =>
      new Promise((resolve) => {
        finishRetry = () => {
          opts?.onModelLoaded?.()
          resolve({ chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] })
        }
      }),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} onComplete={onComplete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /high accuracy/i }))
    fireEvent.click(screen.getByRole('button', { name: /start auto-align/i }))

    await waitFor(() =>
      expect(screen.getByText(/high-accuracy model failed.*retrying with the standard model/i)).toBeTruthy(),
    )
    // Back on the loading step (not a dead transcribe bar) while the standard
    // model downloads/initializes.
    expect(screen.getByText('Loading AI model')).toBeTruthy()

    finishRetry()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio.mock.calls[1][2]?.highAccuracy).toBe(false)
    expect(screen.queryByText(/retrying with the standard model/i)).toBeNull()
  })
})

describe('AutoAlignFlow user-facing copy', () => {
  it('labels the word-level pass "Accurate timing (slower)"', () => {
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /accurate timing \(slower\)/i })).toBeTruthy()
    expect(screen.queryByText(/word-level timestamps/i)).toBeNull()
  })

  it('describes the lite tier as a plain outcome, not "Transcription only"', () => {
    deviceTier.current = 'lite'
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/listens to your song on this device and times each lyric line/i)).toBeTruthy()
    expect(screen.queryByText(/transcription only/i)).toBeNull()
  })

  it('shows user copy when the vocal-separation model is missing and logs the dev detail', async () => {
    deviceTier.current = 'full'
    vocalSepSupported.current = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<AutoAlignFlow song={song} onComplete={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText(/vocal isolation isn't available right now/i)).toBeTruthy(),
    )
    // The deployment-docs pointer is operator info: console, not UI.
    expect(screen.queryByText(/DEPLOYMENT\.md/i)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('docs/DEPLOYMENT.md'))
    warn.mockRestore()
  })
})

describe('AutoAlignFlow first-run download consent', () => {
  it('gates the first-ever download behind a one-time prompt and only starts on Continue', async () => {
    settings.consented = false
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    // The consent prompt is shown and alignment has NOT auto-started.
    expect(screen.getByText(/first-song setup/i)).toBeTruthy()
    expect(screen.getByText(/~240MB speech model/i)).toBeTruthy()
    expect(screen.queryByText(/preparing audio/i)).toBeNull()
    expect(transcribeAudio).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(transcribeAudio).toHaveBeenCalled()
    // Consent was remembered.
    expect(settings.consented).toBe(true)
  })

  it('skips the prompt and autostarts directly once consent is remembered', async () => {
    settings.consented = true
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    expect(screen.queryByText(/first-song setup/i)).toBeNull()
    expect(screen.getByText(/preparing audio/i)).toBeTruthy()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('closes without downloading when the user picks "Not now"', () => {
    settings.consented = false
    const onClose = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(onClose).toHaveBeenCalled()
    expect(transcribeAudio).not.toHaveBeenCalled()
    expect(settings.consented).toBe(false)
  })
})

describe('AutoAlignFlow friendly errors', () => {
  it('shows friendly copy for an unclassified failure, with the raw message in a details disclosure', async () => {
    // Lite tier has no downgrade ladder, so a thrown error reaches the error stage
    // directly (no retry) — see the crash-downgrade suite for the word/high-acc path.
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error('Unexpected token < in JSON at position 0')
    })
    render(<AutoAlignFlow song={song} autoStart onComplete={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText(/something went wrong during auto-align\. your song is saved/i)).toBeTruthy(),
    )
    // The raw exception text is NOT the primary message…
    expect(screen.queryByText((_c, el) =>
      el?.tagName === 'P' && /^Unexpected token < in JSON at position 0$/.test(el.textContent ?? '')
      && !el.closest('details'),
    )).toBeNull()
    // …but IS available under a collapsible "details" disclosure.
    expect(screen.getByText(/technical details/i)).toBeTruthy()
    const detail = screen.getByText(/unexpected token < in json at position 0/i)
    expect(detail.closest('details')).not.toBeNull()
  })

  it('maps a model-download failure to connection guidance', async () => {
    transcribeAudio.mockImplementationOnce(async (_audio, _rate, opts) => {
      opts?.onModelLoaded?.()
      throw new Error('Failed to fetch model weights')
    })
    render(<AutoAlignFlow song={song} autoStart onComplete={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText(/couldn't download the speech model/i)).toBeTruthy(),
    )
  })
})
