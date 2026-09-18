import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import { separateVocals } from '../../src/ai-pipeline/demucsSeparator'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

/**
 * Two recovery levers, both measured on a real song (AKFG "Rock'n'Roll, Morning
 * Light Falls on You", THE FIRST TAKE) where the app's defaults were the worst
 * available combination:
 *
 *  1. Post-transcription stem guard. `assessStemQuality` only rejects a DESTROYED
 *     stem (near-silence). This one caught the stem that transcribes badly: live,
 *     the isolated run scored 0 of 30 rows 'good' at 15.4s mean error while the
 *     mix scored 21 of 30 at 2.8s. The flow must notice and re-align the mix.
 *  2. The mode the user can actually reach. Word timestamps are the default on
 *     every tier, but when their long-form merge drifts, segment is far better
 *     (that song: 2.8s word vs 0.4s segment on the mix). The low-confidence result
 *     screen therefore offers the OTHER mode as a one-tap re-run.
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

// 48kHz decode (Firefox's usual AudioContext rate) — the rate the mix path must
// keep once the stem is discarded.
const mixAudio = new Float32Array(48000)
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => ({ data: mixAudio, sampleRate: 48000 })),
}))

// A voiced vocal-band tone so the pre-transcription guard accepts the stem — the
// failure under test happens AFTER transcription.
const stemAudio = (() => {
  const buf = new Float32Array(44100)
  for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / 44100)
  return buf
})()
vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real,
    isDemucsModelAvailable: vi.fn(async () => true),
    refreshDemucsModelAvailability: vi.fn(async () => true),
    separateVocals: vi.fn(async () => stemAudio),
  }
})

// The gap re-pass rewrites lines and labels (it re-aligns a hole through the real
// sub-refiner), which would change the very labels these specs assert on. Its own
// behaviour is covered by gapReanalyze*/gapRecovery* specs; here it is a pass-through
// so each spec observes only the pass the flow under test ran.
vi.mock('../../src/ai-pipeline/gapReanalyze', () => ({
  reanalyzeGaps: async (args: { refined: unknown; transcriptWords: unknown }) => ({
    refined: args.refined,
    transcriptWords: args.transcriptWords,
    filledCount: 0,
  }),
}))

const transcribeAudio = vi.fn(async (_audio: Float32Array, _rate: number, opts?: { onModelLoaded?: () => void }) => {
  opts?.onModelLoaded?.()
  return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
})
vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))

const lines = (...texts: string[]) => texts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))

/** An alignment whose lines all sit on vocals, with the given labels. */
function alignment(labels: ('good' | 'needs_review')[], confidence: number): RefinedAlignment {
  const texts = lines('hello', 'world', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth')
  return {
    lines: texts.map((l, i) => ({ ...l, startTime: i * 2, endTime: i * 2 + 1.8 })),
    confidence,
    mode: 'content',
    lineAlignmentQuality: labels,
  } as unknown as RefinedAlignment
}

// First refinement = the stem (weak labels), second = the mix fallback (strong).
const refineAlignmentWithPhrases = vi.fn()
vi.mock('../../src/lyrics/phraseAlignment', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lyrics/phraseAlignment')>()
  return {
    ...real,
    refineAlignmentWithPhrases: (...args: unknown[]) =>
      (refineAlignmentWithPhrases as unknown as (...a: unknown[]) => unknown)(...args),
  }
})

const song: Song = {
  id: 's1',
  title: 'T',
  artist: 'A',
  sources: [],
  audioStoredPath: '/audio/s1',
  lyrics: {
    lines: lines('hello', 'world', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'),
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
  refineAlignmentWithPhrases.mockReset()
  vi.mocked(separateVocals).mockReset()
  vi.mocked(separateVocals).mockResolvedValue(stemAudio)
})

describe('AutoAlignFlow stem-pass guard', () => {
  it('discards an unverifiable stem pass and re-aligns the decoded mix', { timeout: 30_000 }, async () => {
    // Stem pass: almost nothing verified (the live failure: 0 of 30 rows).
    refineAlignmentWithPhrases
      .mockReturnValueOnce(alignment(['needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review'], 0.2))
      // Mix pass: verified.
      .mockReturnValueOnce(alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'], 0.8))

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    // Two passes: the stem, then the mix.
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    const [stemArg, stemRate] = transcribeAudio.mock.calls[0]
    const [mixArg, mixRate] = transcribeAudio.mock.calls[1]
    expect(stemArg).toBe(stemAudio)
    expect(stemRate).toBe(44100)
    // The fallback used the DECODED MIX at the DECODE rate, not the stem.
    expect(mixArg).toBe(mixAudio)
    expect(mixRate).toBe(48000)

    // And the song was saved from the second (verified) pass.
    const saved = await db.songs.get('s1')
    expect(saved?.lyrics.lines[0].startTime).toBe(0)
    expect(saved?.lyrics.lines[1].startTime).toBe(2)
  })

  it('keeps a stem pass that IS verifiable, with no second transcription', { timeout: 30_000 }, async () => {
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'approximate'] as never, 0.8),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    // One pass only — isolation is not paid for twice on songs where it works.
    expect(transcribeAudio).toHaveBeenCalledTimes(1)
    expect(transcribeAudio.mock.calls[0][0]).toBe(stemAudio)
  })
})

describe('AutoAlignFlow timestamp-mode re-run', () => {
  it('offers the other mode when a word-mode run comes back low-confidence', { timeout: 30_000 }, async () => {
    // Isolation off for both runs, so each is exactly one pass and the only thing
    // changing between them is the mode under test.
    vi.mocked(separateVocals).mockRejectedValue(new Error('isolation unavailable'))
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review'], 0.15),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    // Default mode on this tier is word — and the run reports it.
    expect(transcribeAudio.mock.calls[0][2]?.timestampMode).toBe('word')

    // Offered even though the run was flagged low-confidence here; the companion
    // case below covers a CONFIDENT run that still leaves lines unverified.
    const retry = await screen.findByText('Try again with segment timestamps')
    fireEvent.click(retry)

    await waitFor(() => expect(transcribeAudio.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 20_000 })
    expect(transcribeAudio.mock.calls[1][2]?.timestampMode).toBe('segment')
  })
})

describe('AutoAlignFlow timestamp-mode offer on an unverified-but-confident run', () => {
  it('offers the other mode when enough lines stay unverified, without a low-confidence warning', { timeout: 30_000 }, async () => {
    vi.mocked(separateVocals).mockRejectedValue(new Error('isolation unavailable'))
    // Confident overall (0.8 → no low-confidence screen) but 7 rows unverified —
    // the live shape after the stem guard fired (20/30 verified, 4 lines >3s).
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'approximate', 'needs_review', 'needs_review'], 0.8),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    expect(await screen.findByText('Lyrics aligned successfully.')).toBeTruthy()
    expect(await screen.findByText('Try again with segment timestamps')).toBeTruthy()
  })

  it('stays quiet when the result is clean (no pointless re-run)', { timeout: 30_000 }, async () => {
    vi.mocked(separateVocals).mockRejectedValue(new Error('isolation unavailable'))
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'approximate'] as never, 0.8),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    expect(await screen.findByText('Lyrics aligned successfully.')).toBeTruthy()
    expect(screen.queryByText('Try again with segment timestamps')).toBeNull()
  })
})

describe('AutoAlignFlow per-song isolation memory', () => {
  it('skips the separation for a song whose stem already proved useless', { timeout: 30_000 }, async () => {
    const known = { ...song, id: 's2', audioIsolationVerdict: 'unusable' as const }
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'approximate'] as never, 0.8),
    )

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={known} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    // The 17-minute separation the previous run already paid for is not repeated,
    // even though the setting is ON.
    expect(separateVocals).not.toHaveBeenCalled()
    expect(transcribeAudio.mock.calls[0][0]).toBe(mixAudio)
  })

  it('records the verdict so the next run can skip it', { timeout: 30_000 }, async () => {
    // Stem pass unverifiable → the run discards it and remembers why.
    refineAlignmentWithPhrases
      .mockReturnValueOnce(alignment(Array.from({ length: 8 }, () => 'needs_review') as never, 0.2))
      .mockReturnValueOnce(alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'], 0.8))

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })

    const saved = await db.songs.get('s1')
    expect(saved?.audioIsolationVerdict).toBe('unusable')
  })

  it('still separates when the user explicitly asks, despite the verdict', { timeout: 30_000 }, async () => {
    const known = { ...song, id: 's3', audioIsolationVerdict: 'unusable' as const }
    refineAlignmentWithPhrases.mockReturnValue(
      alignment(['good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'], 0.8),
    )

    const onComplete = vi.fn()
    // No autoStart: the idle screen with the toggles is shown, so the user can ask
    // for isolation explicitly — which must beat the remembered verdict.
    render(<AutoAlignFlow song={known} onComplete={onComplete} onClose={vi.fn()} />)
    // The toggle starts OFF for this song (the remembered verdict), so ticking it
    // is unambiguously an explicit ask.
    const toggle = (await screen.findByText('Isolate vocals first')).closest('label')!.querySelector('input')!
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByText('Start Auto-Align'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 20_000 })
    expect(separateVocals).toHaveBeenCalledTimes(1)
    expect(transcribeAudio.mock.calls[0][0]).toBe(stemAudio)
  })
})
