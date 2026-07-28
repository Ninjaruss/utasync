import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LyricsData, LineAlignmentQuality, TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * Gap recovery must re-transcribe on the SAME source the fresh align uses. When
 * isolation is requested it feeds the sanity-guarded Demucs stem (at 44100 Hz, not
 * the decode rate — else every slice window desyncs) to the slice transcriber; a
 * destroyed stem is rejected and it falls back to the raw mix. The guard
 * (computeVocalActivity + assessStemQuality) runs for real here.
 */

// Capture exactly what audio buffer + rate the slice transcriber receives.
const sliceDeps: { audioData: Float32Array | null; sampleRate: number } = { audioData: null, sampleRate: 0 }
const mockTranscribe = vi.fn(async (): Promise<TranscriptWord[]> => [])
vi.mock('../../src/ai-pipeline/sliceTranscriber', () => ({
  createSliceTranscriber: (deps: { audioData: Float32Array; sampleRate: number }) => {
    sliceDeps.audioData = deps.audioData
    sliceDeps.sampleRate = deps.sampleRate
    return { transcribe: () => mockTranscribe() }
  },
}))

// Mix decodes at 48000 so it is distinguishable from the 44100 stem.
const MIX = new Float32Array(48000)
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => ({ data: MIX, sampleRate: 48000 })),
}))
vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([new Uint8Array(1)], 'song.mp3')),
}))

let stemToReturn: Float32Array
const isDemucsAvailable = vi.fn(async () => true)
const separateVocalsSpy = vi.fn(async () => stemToReturn)
vi.mock('../../src/ai-pipeline/demucsSeparator', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/demucsSeparator')>()
  return {
    ...real, // keep DEMUCS_OUTPUT_SAMPLE_RATE (44100)
    isDemucsModelAvailable: () => isDemucsAvailable(),
    separateVocals: () => separateVocalsSpy(),
  }
})

import { recoverGapsForStoredSong } from '../../src/ai-pipeline/gapRecovery'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({ original, translation: '', startTime, endTime })
const w = (word: string, startTime: number, endTime: number): TranscriptWord => ({ word, startTime, endTime })
function anchorWords(text: string, start: number, end: number): TranscriptWord[] {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}
const BEFORE = 'the quick brown fox jumps over the lazy dog again'
const AFTER = 'every good boy deserves fudge and cake at the party'
const GAP1 = 'moonlight velvet harbor drifting slowly onward'
const GAP2 = 'silver rivers flowing gently through the night'

/** Auto-aligned stored song carrying exactly one recoverable hole. */
function storedWithHole(): LyricsData {
  const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'needs_review', 'good']
  return {
    lines: [line(BEFORE, 10, 14), line(GAP1, 14, 14.1), line(GAP2, 14.1, 14.2), line(AFTER, 44, 48)],
    sourceLanguage: 'en',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    alignmentConfidence: 0.9,
    alignmentPipelineVersion: 20,
    anchorSources: ['lcs', 'interpolated', 'interpolated', 'lcs'],
    lineAlignmentQuality: quality,
    transcriptWords: [
      ...anchorWords(BEFORE, 10, 14),
      { word: 'zzqx', startTime: 26, endTime: 27 },
      ...anchorWords(AFTER, 44, 48),
    ],
  }
}

/** A voiced vocal-band tone: passes the stem sanity guard. */
function voicedStem(): Float32Array {
  const buf = new Float32Array(44100)
  for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / 44100)
  return buf
}

beforeEach(() => {
  sliceDeps.audioData = null
  sliceDeps.sampleRate = 0
  mockTranscribe.mockReset()
  mockTranscribe.mockResolvedValue([])
  isDemucsAvailable.mockResolvedValue(true)
  separateVocalsSpy.mockClear()
})

describe('recoverGapsForStoredSong vocal isolation', () => {
  it('feeds the slice transcriber the guarded stem at 44100 when isolation is on', async () => {
    stemToReturn = voicedStem()
    await recoverGapsForStoredSong({ lyrics: storedWithHole(), songId: 's', isolateVocals: true, isCancelled: () => false })
    expect(separateVocalsSpy).toHaveBeenCalledTimes(1)
    expect(sliceDeps.audioData).toBe(stemToReturn)
    expect(sliceDeps.sampleRate).toBe(44100)
  })

  it('falls back to the raw mix (at the decode rate) when the stem is destroyed', async () => {
    stemToReturn = new Float32Array(44100) // near-silent — guard rejects it
    await recoverGapsForStoredSong({ lyrics: storedWithHole(), songId: 's', isolateVocals: true, isCancelled: () => false })
    expect(separateVocalsSpy).toHaveBeenCalledTimes(1)
    expect(sliceDeps.audioData).toBe(MIX)
    expect(sliceDeps.sampleRate).toBe(48000)
  })

  it('does not separate at all when isolation is off (legacy mix behavior)', async () => {
    stemToReturn = voicedStem()
    await recoverGapsForStoredSong({ lyrics: storedWithHole(), songId: 's', isolateVocals: false, isCancelled: () => false })
    expect(separateVocalsSpy).not.toHaveBeenCalled()
    expect(sliceDeps.audioData).toBe(MIX)
    expect(sliceDeps.sampleRate).toBe(48000)
  })

  it('falls back to the mix when the Demucs model is unavailable', async () => {
    stemToReturn = voicedStem()
    isDemucsAvailable.mockResolvedValue(false)
    await recoverGapsForStoredSong({ lyrics: storedWithHole(), songId: 's', isolateVocals: true, isCancelled: () => false })
    expect(separateVocalsSpy).not.toHaveBeenCalled()
    expect(sliceDeps.audioData).toBe(MIX)
  })
})
