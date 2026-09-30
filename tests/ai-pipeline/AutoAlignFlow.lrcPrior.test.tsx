import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'

/**
 * THE L12 WIRING, which is the largest measured win in the project and had no test.
 *
 * Reconciling against the timings a song already carries beat aligning from scratch on 8/8
 * song-mode pairs at every prior error size, cutting mean absolute p90 from 5.47s to 1.44s
 * (ledger L12). `applyLrcPrior` and its gate `usablePriorTimes` are both unit-tested — but
 * nothing proved that `AutoAlignFlow` actually PASSES the prior, which is the seam where the
 * whole result could silently be a no-op. That is the same class of gap as the drag-strip
 * widening, and it is worth one spec because it guards the biggest number in the ledger.
 *
 * The gate has two halves, and both are asserted here because both are load-bearing:
 *  - a song whose timings came from OUTSIDE (a catalogue entry) must have them used as a prior;
 *  - a song this pipeline already aligned must NOT be anchored to its own output, or a re-run
 *    would be pinned to the timings it is meant to improve.
 */

const deviceTier = vi.hoisted(() => ({ current: 'lite' as 'lite' | 'full' | 'manual' }))
const settings = vi.hoisted(() => ({ consented: true }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => deviceTier.current,
  canUseVocalSeparation: () => false,
  probeWebGPUAdapter: async () => true,
  canAutoAlign: () => true,
}))
vi.mock('../../src/settings/SettingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      vocalSeparationEnabled: null,
      modelDownloadConsented: settings.consented,
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

const transcribeAudio = vi.fn(async (_a: Float32Array, _r: number, opts?: { onModelLoaded?: () => void }) => {
  opts?.onModelLoaded?.()
  // A transcript that corroborates NO line: every placement is therefore "not agreeing with the
  // prior", so the prior alone decides where each line goes.
  return { chunks: [{ text: 'zulu', timestamp: [500, 501] as [number, number] }] }
})
vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
  resetWhisperTranscriber: vi.fn(),
}))
vi.mock('../../src/ai-pipeline/aligner', () => ({
  alignLyrics: vi.fn(() => ({ lines: [], mode: 'content', confidence: 0.9, anchorSources: ['lcs'] })),
  sanitizeTranscript: vi.fn((words: unknown[]) => words),
  lineWeight: vi.fn(() => 1),
  LOW_CONFIDENCE_WARN_THRESHOLD: 0.7,
}))
// A no-op gap pass and a fixed refine: this spec is about the prior, nothing else.
vi.mock('../../src/ai-pipeline/gapReanalyze', () => ({
  reanalyzeGaps: vi.fn(async ({ refined, transcriptWords }: { refined: unknown; transcriptWords: unknown }) => ({
    refined, transcriptWords,
  })),
}))

/** Where the aligner puts the lines when it works only from the transcript. */
const FROM_SCRATCH = [0, 1, 2]
/** Where an external catalogue claims they are — far away, as a differing master would be. */
const CATALOGUE_PRIOR = [100, 110, 120]

vi.mock('../../src/lyrics/phraseAlignment', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lyrics/phraseAlignment')>()
  return {
    ...real,
    refineAlignmentWithPhrases: vi.fn((sheetRows: { original: string; translation: string }[]) => ({
      lines: sheetRows.map((r, i) => ({ ...r, startTime: FROM_SCRATCH[i], endTime: FROM_SCRATCH[i] + 1 })),
      phrases: [],
      report: { merged: 0, split: 0 },
      mode: 'content' as const,
      confidence: 0.9,
      lineAlignmentQuality: sheetRows.map(() => 'needs_review' as const),
      phraseLayout: 'sheet' as const,
    })),
  }
})

function makeSong(over: Partial<Song['lyrics']>): Song {
  return {
    id: 'prior-1', title: 'P', artist: 'A', sources: [], audioStoredPath: '/audio/prior-1',
    lyrics: {
      lines: [0, 1, 2].map((i) => ({
        startTime: CATALOGUE_PRIOR[i], endTime: CATALOGUE_PRIOR[i] + 1,
        original: `line ${i}`, translation: '',
      })),
      sourceLanguage: 'ja', translationLanguage: 'en',
      ...over,
    },
    syncState: 'unsynced', createdAt: new Date(),
  } as Song
}

beforeEach(async () => {
  await db.songs.clear()
  transcribeAudio.mockClear()
  deviceTier.current = 'lite'
})

describe('AutoAlignFlow applies a catalogue song\'s own timings as a prior (L12 wiring)', () => {
  it('pulls lines back onto the prior when the transcript alone would place them elsewhere', async () => {
    // `alignmentMode` is not 'auto' and every line is timed: this is a catalogue entry, exactly
    // the case the prior exists for.
    await db.songs.put(makeSong({ alignmentMode: 'manual', timingSource: 'lrclib' }))
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={makeSong({ alignmentMode: 'manual', timingSource: 'lrclib' })} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    const saved = await db.songs.get('prior-1')
    const starts = saved!.lyrics.lines.map((l) => l.startTime)
    // NOT the from-scratch placements: the prior decided.
    expect(starts).not.toEqual(FROM_SCRATCH)
    for (let i = 0; i < starts.length; i++) {
      expect(Math.abs(starts[i] - CATALOGUE_PRIOR[i]), `line ${i} should sit on the prior`).toBeLessThanOrEqual(1)
    }
  })

  it('REFUSES to anchor a re-run to this pipeline\'s own output', async () => {
    // `alignmentMode: 'auto'` means these timings came from us. Using them as a prior would pin
    // the alignment to the very timings it is meant to improve, so the gate must refuse and the
    // from-scratch placements must stand.
    const song = makeSong({ alignmentMode: 'auto', timingSource: 'aligned' })
    await db.songs.put(song)
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    const saved = await db.songs.get('prior-1')
    expect(saved!.lyrics.lines.map((l) => l.startTime)).toEqual(FROM_SCRATCH)
  })
})
