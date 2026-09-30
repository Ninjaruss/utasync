import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { LineAlignmentQuality, Song } from '../../src/core/types'
import type { AlignmentTrust, LineTrustVerdict } from '../../src/ai-pipeline/alignmentTrust'
import { db } from '../../src/core/db/schema'

/**
 * Automatic per-song timestamp-mode selection, end to end through the real
 * component (see src/ai-pipeline/alignModeChoice.ts).
 *
 * Before this, recovering from the word-mode long-form merge failure — the one
 * alignTimestampMode.ts measures at mean 5.61s against segment's 0.74s on the same
 * audio — required the user to read a result screen telling them their song had
 * come out wrong, then tap "Try again with segment timestamps". These specs prove
 * the app now does it itself, and that a worse (or equal) second pass is discarded
 * rather than shipped.
 *
 * The aligner is mocked to label each run according to the timestamp mode the
 * transcriber was last asked for, and to place its lines at a mode-specific start
 * time (11s for word, 22s for segment) — which is how each spec proves WHICH run
 * reached the database.
 */

const deviceTier = vi.hoisted(() => ({ current: 'lite' as 'lite' | 'full' | 'manual' }))
const settings = vi.hoisted(() => ({ consented: true }))
const lastMode = vi.hoisted(() => ({ current: 'word' as 'word' | 'segment' }))
const modesRequested = vi.hoisted(() => ({ all: [] as string[] }))
/** Labels each mode's run comes back with; set per spec. */
const labels = vi.hoisted(() => ({
  word: ['approximate'] as LineAlignmentQuality[],
  segment: ['good'] as LineAlignmentQuality[],
}))
/** Start time each mode's run places its lines at. */
const starts = vi.hoisted(() => ({ word: 11, segment: 22 }))

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => deviceTier.current,
  canUseVocalSeparation: () => false,
  probeWebGPUAdapter: async () => true,
}))

vi.mock('../../src/settings/SettingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      vocalSeparationEnabled: null,
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

const transcribeAudio = vi.fn(async (_a: Float32Array, _r: number, opts?: {
  onModelLoaded?: () => void
  timestampMode?: 'word' | 'segment'
}) => {
  opts?.onModelLoaded?.()
  lastMode.current = opts?.timestampMode ?? 'word'
  modesRequested.all.push(lastMode.current)
  return { chunks: [{ text: 'hello', timestamp: [0, 1] as [number, number] }] }
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

// Gap re-transcription: a no-op by default (so the mode specs isolate the mode decision),
// and scriptable for the convergence-loop specs below via `gapPasses`.
const gapPasses = vi.hoisted(() => ({
  impl: null as null | ((call: number) => { start: number; quality: LineAlignmentQuality; text?: string } | null),
}))
const gapCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../src/ai-pipeline/gapReanalyze', () => ({
  reanalyzeGaps: vi.fn(async ({ refined, transcriptWords }: { refined: unknown; transcriptWords: unknown }) => {
    gapCalls.n += 1
    const planned = gapPasses.impl?.(gapCalls.n)
    if (!planned) return { refined, transcriptWords }
    const r = refined as { lines: Array<Record<string, unknown>> }
    return {
      refined: {
        ...(refined as object),
        // `text` optionally replaces the row text, which is how a spec makes a pass
        // degrade something the verdict can actually SEE. Changing only the timestamp is
        // not enough: the verdict grades placement against the row's matched evidence and
        // the audio, so two timestamps that are both far from the evidence grade alike.
        lines: r.lines.map((l) => ({
          ...l,
          startTime: planned.start,
          ...(planned.text != null ? { original: planned.text } : {}),
        })),
        lineAlignmentQuality: r.lines.map(() => planned.quality),
      },
      transcriptWords,
    }
  }),
}))

vi.mock('../../src/lyrics/phraseAlignment', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lyrics/phraseAlignment')>()
  return {
    ...real,
    refineAlignmentWithPhrases: vi.fn((sheetRows: { original: string; translation: string }[]) => {
      const mode = lastMode.current
      const startTime = starts[mode]
      const quality = labels[mode][0]
      return {
        lines: sheetRows.map((r) => ({ ...r, startTime, endTime: startTime + 2 })),
        phrases: [],
        report: { merged: 0, split: 0 },
        mode: 'content' as const,
        confidence: 0.9,
        lineAlignmentQuality: sheetRows.map(() => quality),
        phraseLayout: 'sheet' as const,
      }
    }),
  }
})

/**
 * Scriptable verdict sequence, consumed one entry per `assessAlignmentTrust` call.
 *
 * An EMPTY queue falls through to the real verdict, so every other spec in this file keeps
 * its real behaviour. `isBetterAlignment` and `isWorseAlignment` are deliberately NOT mocked:
 * the defect these specs guard against was in how the loop USED the comparators, not in the
 * comparators themselves, so a mocked comparator would hide exactly the bug of interest.
 *
 * `assessAlignmentTrust` has one call site (AutoAlignFlow.tsx, the convergence block), so the
 * call order is fully determined: #1 is the pre-loop verdict, #2 the first round, #3 the second.
 */
const trustScript = vi.hoisted(() => ({ queue: [] as unknown[] }))

vi.mock('../../src/ai-pipeline/alignmentTrust', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ai-pipeline/alignmentTrust')>()
  return {
    ...real,
    assessAlignmentTrust: (args: Parameters<typeof real.assessAlignmentTrust>[0]) => {
      const scripted = trustScript.queue.shift()
      return (scripted ?? real.assessAlignmentTrust(args)) as ReturnType<
        typeof real.assessAlignmentTrust
      >
    },
  }
})

const song: Song = {
  id: 'mode-1',
  title: 'Mode',
  artist: 'A',
  sources: [],
  audioStoredPath: '/audio/mode-1',
  lyrics: {
    // Enough lines that the unverified-share trigger is exercised alongside the
    // verdict trigger.
    lines: Array.from({ length: 8 }, () => ({ startTime: 0, endTime: 0, original: 'hello', translation: '' })),
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
  settings.consented = true
  lastMode.current = 'word'
  modesRequested.all = []
  labels.word = ['approximate']
  labels.segment = ['good']
  gapPasses.impl = null
  gapCalls.n = 0
  trustScript.queue = []
})

describe('automatic timestamp-mode escalation', () => {
  it('re-runs in segment mode by itself when the word-mode run is weak, and keeps the better result', async () => {
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    // Both passes actually ran: word first, then segment — with no user action.
    expect(modesRequested.all).toContain('word')
    expect(modesRequested.all).toContain('segment')

    // The segment run's placement (22s) is the one persisted, because its labels
    // ('good' → verdict 1.0) beat the word run's ('approximate' → 0.5).
    const saved = await db.songs.get(song.id)
    expect(saved?.lyrics.lines[0].startTime).toBe(starts.segment)
    // Persisted exactly once, so a flow cannot leave a half-written result behind.
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('discards the escalation when the second pass is no better, keeping the first run', async () => {
    labels.segment = ['needs_review'] // verdict 0, worse than word's 0.5
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    expect(modesRequested.all).toContain('segment')
    const saved = await db.songs.get(song.id)
    // The first (word) run's placement survived: accept-if-better means the extra
    // pass can never make a song worse than it already was.
    expect(saved?.lyrics.lines[0].startTime).toBe(starts.word)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not pay for a second pass when the word-mode run is already healthy', async () => {
    labels.word = ['good'] // verdict 1.0, nothing unverified
    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    expect(modesRequested.all).toEqual(['word'])
    const saved = await db.songs.get(song.id)
    expect(saved?.lyrics.lines[0].startTime).toBe(starts.word)
  })
})

/**
 * The convergence loop — the product intent as behaviour: "the aligner does its best and
 * is then auto-corrected until the sync is accurate".
 *
 * Before this, the flow ran ONE fixed budget of gap repairs and then declared done, whatever
 * the result looked like. These specs prove the loop (a) keeps repairing while the
 * truth-free verdict improves, and (b) DISCARDS any repair — including the standalone gap
 * pass — that the verdict says made things worse, so extra transcription can never leave a
 * song worse than it already was.
 *
 * The verdict's acoustic half needs a vocal envelope, which these specs do not have, so the
 * verdict here is text-only and cannot certify. That is exactly why the loop exits on
 * no-improvement rather than on `converged`, which is 0/8 across the corpus (ledger L15).
 */
describe('convergence loop', () => {
  it('keeps repairing while the verdict improves, then stops', async () => {
    // Round 1 improves the verdict (labels approximate -> good); round 2 does not.
    gapPasses.impl = (call) =>
      call === 1 ? { start: starts.word, quality: 'good' } : { start: starts.word, quality: 'approximate' }

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    // Two gap passes ran: one before the loop, one accepted round. The third stopped it.
    expect(gapCalls.n).toBeGreaterThanOrEqual(2)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('never lets a losing repair ROUND reach the database', async () => {
    // The standalone pass is a no-op (it has its own accept-if-better and is not re-vetoed
    // here), so the state entering the loop is the good one. The loop's round then makes
    // things strictly worse and must be discarded rather than persisted.
    labels.word = ['good']
    gapPasses.impl = (call) => (call === 1 ? null : { start: 500, quality: 'needs_review', text: 'zzzz' })

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    const saved = await db.songs.get(song.id)
    expect(saved?.lyrics.lines[0].startTime).toBe(starts.word)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  /**
   * The specs above drive the loop through the REAL verdict, whose tiering here is dominated
   * by transcript coverage on a one-chunk stub — so a round generally lands on a TIE, and an
   * assertion like `gapCalls.n >= 2` is satisfied by a loop that only ever ran ONE round.
   * These two specs therefore script the verdict directly to pin the DECISION itself.
   *
   * They are regression guards for a defect that shipped: the loop reassigned `trust = next`
   * on the line immediately before testing `isBetterAlignment(next, trust)`, i.e. it compared
   * a verdict with ITSELF. `isBetterAlignment` returns false on a tie by design (asserted in
   * alignmentTrust.test.ts), so the negated test was always true and the loop broke after the
   * first round unconditionally — making MAX_TRUST_ROUNDS unreachable and capping
   * "auto-correct until accurate" at exactly one repair round, however good the run got.
   */
  const verdict = (o: {
    noEvidence: number
    verifiedShare: number
    repairable: number[]
  }): AlignmentTrust => ({
    lines: Array.from({ length: 8 }, (_, i): LineTrustVerdict => ({
      lineIndex: i,
      trust: i < o.noEvidence ? 'unverified' : 'verified',
      coverage: i < o.noEvidence ? 0 : 0.9,
      agreementSec: i < o.noEvidence ? null : 0.1,
      acousticRise: null,
      reasons: i < o.noEvidence ? ['no-evidence'] : [],
    })),
    verifiedShare: o.verifiedShare,
    noEvidenceShare: o.noEvidence / 8,
    acousticallyChecked: 0,
    repairableLineIndices: o.repairable,
    converged: false,
  })

  it('runs a SECOND repair round while the verdict keeps improving (MAX_TRUST_ROUNDS is reachable)', async () => {
    // Each step strictly reduces the no-evidence count, which is the comparator's
    // second-ranked term, so #2 beats #1 and #3 beats #2.
    trustScript.queue = [
      verdict({ noEvidence: 4, verifiedShare: 0.3, repairable: [0, 1, 2, 3] }),
      verdict({ noEvidence: 2, verifiedShare: 0.6, repairable: [0, 1] }),
      verdict({ noEvidence: 0, verifiedShare: 1, repairable: [] }),
    ]

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    // One standalone gap pass plus TWO loop rounds. The self-comparison bug produced 2 here,
    // so this exact number is what distinguishes "the budget is usable" from "one round only".
    expect(gapCalls.n).toBe(3)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('stops after one round on a TIE, without spending another transcription', async () => {
    const tied = () => verdict({ noEvidence: 4, verifiedShare: 0.3, repairable: [0, 1, 2, 3] })
    trustScript.queue = [tied(), tied(), tied()]

    const onComplete = vi.fn()
    render(<AutoAlignFlow song={song} autoStart onComplete={onComplete} onClose={vi.fn()} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalled())

    // The standalone pass plus exactly one round: a tie is a stop, not a retry.
    expect(gapCalls.n).toBe(2)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

