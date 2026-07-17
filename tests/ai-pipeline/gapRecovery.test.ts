import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LyricsData, LineAlignmentQuality, TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

// The stored-song gap-recovery routine is exercised without real Whisper: the
// slice transcriber is mocked so each re-transcription returns exactly the words
// the test dictates, and the audio decode/OPFS fetch are stubbed (jsdom has no
// AudioContext). enumerateGapHoles / spliceGapAlignment / applyRefinedAlignment
// run for real, so the accept-if-better safety net is genuinely tested.

const mockTranscribe = vi.fn(
  async (_t0: number, _t1: number, _lang: string, _prompt?: string): Promise<TranscriptWord[]> => [],
)
vi.mock('../../src/ai-pipeline/sliceTranscriber', () => ({
  createSliceTranscriber: () => ({
    transcribe: (...args: Parameters<typeof mockTranscribe>) => mockTranscribe(...args),
  }),
}))

const decodeAudioFileToMono = vi.fn(async () => ({ data: new Float32Array(4000), sampleRate: 100 }))
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: (...args: unknown[]) => decodeAudioFileToMono(...(args as [])),
}))

const getAudioFile = vi.fn(async () => new File([new Uint8Array(1)], 'song.mp3'))
vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: (...args: unknown[]) => getAudioFile(...(args as [])),
}))

import {
  GAP_RECOVERY_VERSION,
  reconstructRefinedFromLyrics,
  countRecoverableHoles,
  shouldAutoRecoverGaps,
  recoverGapsForStoredSong,
} from '../../src/ai-pipeline/gapRecovery'
import { enumerateGapHoles } from '../../src/lyrics/gapRealign'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

const w = (word: string, startTime: number, endTime: number): TranscriptWord => ({
  word,
  startTime,
  endTime,
})

function anchorWords(text: string, start: number, end: number): TranscriptWord[] {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

const BEFORE = 'the quick brown fox jumps over the lazy dog again'
const AFTER = 'every good boy deserves fudge and cake at the party'
const GAP1 = 'moonlight velvet harbor drifting slowly onward'
const GAP2 = 'silver rivers flowing gently through the night'

const garbage = (t0: number, t1: number): TranscriptWord[] => [
  ...anchorWords('zzqx wkpb jjvg xxqq kkzz', t0 + 1, (t0 + t1) / 2 - 1),
  ...anchorWords('qqww eezz rrtt yyuu ppxx', (t0 + t1) / 2 + 1, t1 - 1),
]

function cleanGapSlice(t0: number, t1: number): TranscriptWord[] {
  const mid = t0 + (t1 - t0) / 2
  return [...anchorWords(GAP1, t0 + 1, mid - 1), ...anchorWords(GAP2, mid + 1, t1 - 1)]
}

/** Auto-aligned stored song with one hole (GAP1/GAP2 crammed into a sliver after
 * the first anchor, un-corroborated by the stored transcript over [14,44]). */
function storedWithHole(overrides: Partial<LyricsData> = {}): LyricsData {
  const lines = [
    line(BEFORE, 10, 14),
    line(GAP1, 14, 14.1),
    line(GAP2, 14.1, 14.2),
    line(AFTER, 44, 48),
  ]
  const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'needs_review', 'good']
  return {
    lines,
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
    ...overrides,
  }
}

/** Same song, fully aligned (no holes). */
function storedNoHole(): LyricsData {
  return storedWithHole({
    lines: [line(BEFORE, 10, 14), line(GAP1, 14, 18), line(AFTER, 44, 48)],
    lineAlignmentQuality: ['good', 'good', 'good'],
    anchorSources: ['lcs', 'lcs', 'lcs'],
    transcriptWords: [
      ...anchorWords(BEFORE, 10, 14),
      ...anchorWords(GAP1, 14, 18),
      ...anchorWords(AFTER, 44, 48),
    ],
  })
}

beforeEach(() => {
  mockTranscribe.mockReset()
  mockTranscribe.mockResolvedValue([])
  decodeAudioFileToMono.mockClear()
  getAudioFile.mockClear()
})

describe('reconstructRefinedFromLyrics', () => {
  it('round-trips: the reconstructed refined view yields the same gap holes', () => {
    const lyrics = storedWithHole()
    const refined = reconstructRefinedFromLyrics(lyrics)
    const holes = enumerateGapHoles(refined, lyrics.transcriptWords ?? [])
    expect(holes).toHaveLength(1)
    expect(holes[0].from).toBe(1)
    expect(holes[0].to).toBe(2)
    // The alignment view carries the persisted quality + anchors 1:1 with lines.
    expect(refined.lineAlignmentQuality).toEqual(lyrics.lineAlignmentQuality)
    expect(refined.anchorSources).toEqual(lyrics.anchorSources)
    expect(refined.lines).toBe(lyrics.lines)
  })

  it('uses the sheet snapshot as the alignment view when a song is in sung layout', () => {
    const sheet = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1),
      line(GAP2, 14.1, 14.2),
      line(AFTER, 44, 48),
    ]
    const lyrics = storedWithHole({
      lines: [line(`${GAP1} ${GAP2}`, 14, 14.2)], // sung phrase display rows
      phraseLayout: 'sung',
      sheetLinesSnapshot: sheet,
    })
    const refined = reconstructRefinedFromLyrics(lyrics)
    expect(refined.lines).toBe(sheet)
    // Quality is 1:1 with the sheet rows → the hole is still findable.
    expect(enumerateGapHoles(refined, lyrics.transcriptWords ?? [])).toHaveLength(1)
  })
})

describe('countRecoverableHoles', () => {
  it('counts holes worth retrying from stored lines + quality + transcript', () => {
    expect(countRecoverableHoles(storedWithHole())).toBe(1)
  })

  it('is 0 for a fully aligned song', () => {
    expect(countRecoverableHoles(storedNoHole())).toBe(0)
  })

  it('is 0 for a manual song with no stored transcript', () => {
    expect(countRecoverableHoles({ ...storedWithHole(), alignmentMode: 'manual', transcriptWords: [] })).toBe(0)
  })
})

describe('shouldAutoRecoverGaps', () => {
  it('fires when under-version, has audio, not auto-aligning, and holes exist', () => {
    expect(shouldAutoRecoverGaps(storedWithHole(), { willAutoAlign: false, hasAudio: true })).toBe(true)
  })

  it('does not fire when a fresh Auto-align is already about to run', () => {
    expect(shouldAutoRecoverGaps(storedWithHole(), { willAutoAlign: true, hasAudio: true })).toBe(false)
  })

  it('does not fire without local audio', () => {
    expect(shouldAutoRecoverGaps(storedWithHole(), { willAutoAlign: false, hasAudio: false })).toBe(false)
  })

  it('does not re-fire once gapRecoveryVersion is current', () => {
    const stamped = storedWithHole({ gapRecoveryVersion: GAP_RECOVERY_VERSION })
    expect(shouldAutoRecoverGaps(stamped, { willAutoAlign: false, hasAudio: true })).toBe(false)
  })

  it('does not fire when there are no holes', () => {
    expect(shouldAutoRecoverGaps(storedNoHole(), { willAutoAlign: false, hasAudio: true })).toBe(false)
  })
})

describe('recoverGapsForStoredSong', () => {
  it('fills a hole from a clean re-transcription and stamps gapRecoveryVersion', async () => {
    mockTranscribe.mockImplementation(async (t0: number, t1: number) => cleanGapSlice(t0, t1))
    const lyrics = storedWithHole()

    const res = await recoverGapsForStoredSong({
      lyrics,
      songId: 'song1',
      isCancelled: () => false,
    })

    expect(res).not.toBeNull()
    expect(res!.filledCount).toBe(1)
    expect(res!.lyrics.gapRecoveryVersion).toBe(GAP_RECOVERY_VERSION)
    // Recovered gap words persisted; the stale placeholder word is gone.
    expect(res!.lyrics.transcriptWords!.some((x) => x.word === 'moonlight')).toBe(true)
    expect(res!.lyrics.transcriptWords!.some((x) => x.word === 'zzqx')).toBe(false)
    // The hole's needs_review count dropped.
    const q = res!.lyrics.lineAlignmentQuality!
    expect(q.slice(1, 3).filter((x) => x === 'needs_review').length).toBeLessThan(2)
    expect(getAudioFile).toHaveBeenCalledTimes(1)
    expect(decodeAudioFileToMono).toHaveBeenCalledTimes(1)
  })

  it('reuses a passed audioFile instead of re-fetching from OPFS', async () => {
    mockTranscribe.mockImplementation(async (t0: number, t1: number) => cleanGapSlice(t0, t1))

    const res = await recoverGapsForStoredSong({
      lyrics: storedWithHole(),
      songId: 'song1',
      audioFile: new File([new Uint8Array(1)], 'passed.mp3'),
      isCancelled: () => false,
    })

    expect(res!.filledCount).toBe(1)
    expect(getAudioFile).not.toHaveBeenCalled()
    expect(decodeAudioFileToMono).toHaveBeenCalledTimes(1)
  })

  it('rejects a garbage re-transcription: timing byte-identical but gapRecoveryVersion still stamped', async () => {
    mockTranscribe.mockImplementation(async (t0: number, t1: number) => garbage(t0, t1))
    const lyrics = storedWithHole()

    const res = await recoverGapsForStoredSong({
      lyrics,
      songId: 'song1',
      isCancelled: () => false,
    })

    expect(res).not.toBeNull()
    expect(res!.filledCount).toBe(0)
    // Timing + quality unchanged, transcript unchanged...
    expect(res!.lyrics.lines).toEqual(lyrics.lines)
    expect(res!.lyrics.lineAlignmentQuality).toEqual(lyrics.lineAlignmentQuality)
    expect(res!.lyrics.transcriptWords).toEqual(lyrics.transcriptWords)
    // ...but the version stamp IS applied so auto never re-runs.
    expect(res!.lyrics.gapRecoveryVersion).toBe(GAP_RECOVERY_VERSION)
  })

  it('returns null and never decodes when there are no holes', async () => {
    const res = await recoverGapsForStoredSong({
      lyrics: storedNoHole(),
      songId: 'song1',
      isCancelled: () => false,
    })

    expect(res).toBeNull()
    expect(decodeAudioFileToMono).not.toHaveBeenCalled()
    expect(getAudioFile).not.toHaveBeenCalled()
    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  it('returns null when the stored audio file is missing', async () => {
    getAudioFile.mockRejectedValueOnce(new Error('NotFoundError'))
    const res = await recoverGapsForStoredSong({
      lyrics: storedWithHole(),
      songId: 'song1',
      isCancelled: () => false,
    })

    expect(res).toBeNull()
    expect(decodeAudioFileToMono).not.toHaveBeenCalled()
  })

  it('preserves the sung display layout after recovering (timing flows into sung rows)', async () => {
    mockTranscribe.mockImplementation(async (t0: number, t1: number) => cleanGapSlice(t0, t1))
    const sheet = [
      line(BEFORE, 10, 14),
      line(GAP1, 14, 14.1),
      line(GAP2, 14.1, 14.2),
      line(AFTER, 44, 48),
    ]
    const lyrics = storedWithHole({
      lines: [line(GAP1, 14, 14.1), line(GAP2, 14.1, 14.2)], // sung display rows
      phraseLayout: 'sung',
      sheetLinesSnapshot: sheet,
      phrases: [
        { id: 'p1', startTime: 14, endTime: 14.1, original: GAP1, translation: '', anchorSource: 'lcs', sourceLineIndices: [1] },
        { id: 'p2', startTime: 14.1, endTime: 14.2, original: GAP2, translation: '', anchorSource: 'lcs', sourceLineIndices: [2] },
      ],
    })

    const res = await recoverGapsForStoredSong({ lyrics, songId: 'song1', isCancelled: () => false })

    expect(res!.filledCount).toBe(1)
    // Still sung layout, sheet snapshot retained, gapRecoveryVersion stamped.
    expect(res!.lyrics.phraseLayout).toBe('sung')
    expect(res!.lyrics.sheetLinesSnapshot).toBeTruthy()
    expect(res!.lyrics.gapRecoveryVersion).toBe(GAP_RECOVERY_VERSION)
  })
})
