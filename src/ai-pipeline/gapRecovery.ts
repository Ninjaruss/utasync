import type { LyricsData } from '../core/types'
import { detectSheetLanguage } from './whisperLanguage'
import { reanalyzeGaps } from './gapReanalyze'
import { createSliceTranscriber } from './sliceTranscriber'
import {
  applyRefinedAlignment,
  sheetRowsForAlignment,
  transcriptWordsToAlignInput,
  type RefinedAlignment,
} from '../lyrics/phraseAlignment'
import { applySungLayout } from '../lyrics/phraseLayout'
import { enumerateGapHoles, holeWorthRetrying, lineText } from '../lyrics/gapRealign'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { getAudioFile } from '../core/opfs/audio'

/**
 * Stored-song gap recovery (round 9, R9-2). Lifts round-8's fresh-Auto-align-only
 * limit: an ALREADY-STORED song can re-transcribe its garbled gaps, both
 * automatically once on open (gated by `gapRecoveryVersion`) and on demand via the
 * EditMode "Recover N sections" button. Reuses the exact round-8 machinery —
 * enumerateGapHoles / reanalyzeGaps / spliceGapAlignment's accept-if-better — so a
 * bad re-transcription can NEVER worsen the stored alignment: a rejected splice
 * leaves the alignment content (lines / lineAlignmentQuality / anchorSources /
 * transcriptWords) unchanged. gapRecoveryVersion is still stamped either way, so
 * the returned LyricsData object always differs by at least that field.
 */

/**
 * Bumps when the stored-song gap-recovery behaviour changes. SEPARATE from
 * ALIGNMENT_PIPELINE_VERSION: that gates the pure stored-transcript re-refine,
 * this gates the (expensive, audio-decoding) once-on-open re-transcription so a
 * song is auto-recovered at most once. Stamped regardless of whether any hole was
 * actually filled, so an unrecoverable song doesn't re-load Whisper every open.
 * 2: round-11 focused re-pass — holes now include disguised approximate runs
 * bounded by verified anchors, slices aim at un-transcribed spans, and splices
 * can be accepted on placed-coverage improvement; previously-stamped songs get
 * one more automatic pass with the wider detection.
 */
export const GAP_RECOVERY_VERSION = 2

/**
 * Build a `RefinedAlignment` "alignment view" from the persisted lyrics fields the
 * gap machinery reads. Uses `sheetRowsForAlignment` (the rows the align pass ran
 * on) as `lines`, so it stays 1:1 with the persisted `lineAlignmentQuality` /
 * `anchorSources` even when the song is displayed in sung-phrase layout (where
 * `lyrics.lines` are the sung rows, a different count). `mode`/`report` are stubs:
 * neither enumerateGapHoles nor spliceGapAlignment reads them, and the sub-refine
 * inside the splice recomputes its own.
 */
export function reconstructRefinedFromLyrics(lyrics: LyricsData): RefinedAlignment {
  return {
    lines: sheetRowsForAlignment(lyrics),
    phrases: lyrics.phrases ?? [],
    report: { splits: 0, merges: 0, lowConfidence: 0 },
    mode: 'content',
    confidence: lyrics.alignmentConfidence ?? 1,
    anchorSources: lyrics.anchorSources,
    lineAlignmentQuality: lyrics.lineAlignmentQuality,
    // Always the sheet/alignment view — see the field mapping above. The caller
    // re-applies the sung layout after recovery if the song was displaying it.
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}

/**
 * The reusable inputs to a gap-recovery pass: the alignment view, the alignment
 * rows + their text, the align-input transcript, and the holes worth re-transcribing.
 * Built once and shared so the hole detection isn't recomputed for the count check,
 * the early-out, and the reanalyze call. Returns `null` when the song can't be
 * recovered — it needs a stored Whisper transcript as the run-coverage baseline for
 * "worth retrying", which only auto-aligned songs carry (a hand-timed manual song
 * has nothing to recover against). Pure/cheap — no audio, no Whisper.
 */
function buildGapContext(lyrics: LyricsData) {
  if (!lyrics.transcriptWords?.length) return null
  const refined = reconstructRefinedFromLyrics(lyrics)
  const sheetRows = sheetRowsForAlignment(lyrics)
  const sheetTexts = sheetRows.map(lineText)
  const words = transcriptWordsToAlignInput(lyrics.transcriptWords)
  const holes = enumerateGapHoles(refined, words).filter((h) =>
    holeWorthRetrying(h, words, sheetTexts),
  )
  return { refined, sheetRows, sheetTexts, words, holes }
}

/**
 * How many gap holes are worth re-transcribing — the count shown on the manual
 * "Recover N sections" button and the trigger for auto recovery.
 */
export function countRecoverableHoles(lyrics: LyricsData): number {
  return buildGapContext(lyrics)?.holes.length ?? 0
}

/**
 * The once-on-open predicate: run auto gap recovery only when no fresh Auto-align
 * is already about to run, the song has local audio, it hasn't been auto-recovered
 * at this version yet, and there is at least one hole worth retrying. Pure/cheap so
 * it can be unit-tested apart from the PlayerView effect. Manual recovery bypasses
 * this (it re-attempts regardless of `gapRecoveryVersion`).
 */
export function shouldAutoRecoverGaps(
  lyrics: LyricsData,
  opts: { willAutoAlign: boolean; hasAudio: boolean },
): boolean {
  if (opts.willAutoAlign || !opts.hasAudio) return false
  if ((lyrics.gapRecoveryVersion ?? 0) >= GAP_RECOVERY_VERSION) return false
  return countRecoverableHoles(lyrics) > 0
}

export interface RecoverGapsArgs {
  lyrics: LyricsData
  /** Song id, used to fetch the OPFS audio when `audioFile` isn't supplied. */
  songId: string
  /** Reuse an already-fetched audio File (PlayerView loads one for playback on
   * open) to avoid a second OPFS read; decoded to mono here regardless. */
  audioFile?: File
  isCancelled?: () => boolean
  /** Fired per pass with the number of holes about to be recovered (0 when none) —
   * drives the "Recovering N sections…" status. */
  onProgress?: (holesToRecover: number) => void
  highAccuracy?: boolean
  timestampMode?: 'word' | 'segment'
}

/**
 * Re-transcribe and re-align the recoverable gaps of a stored song. Returns the
 * updated lyrics (with recovered transcript words + `gapRecoveryVersion` stamped)
 * and how many holes were filled, or `null` when there's nothing to do (no holes)
 * or no decodable audio — in which case NO decode or model load happens (cheap
 * early-out). Mixed-language songs are included: accept-if-better protects them.
 */
export async function recoverGapsForStoredSong(
  args: RecoverGapsArgs,
): Promise<{ lyrics: LyricsData; filledCount: number } | null> {
  const {
    lyrics,
    songId,
    audioFile,
    isCancelled,
    onProgress,
    highAccuracy = false,
    timestampMode = 'segment',
  } = args

  // No hole worth a slice → skip the (expensive) decode + model load entirely.
  const ctx = buildGapContext(lyrics)
  if (!ctx || ctx.holes.length === 0) return null
  const { refined, sheetRows, sheetTexts, words } = ctx

  let file = audioFile
  if (!file) {
    try {
      file = await getAudioFile(songId)
    } catch {
      // Audio is missing/unreadable — nothing to re-transcribe from.
      return null
    }
  }
  const { data, sampleRate } = await decodeAudioFileToMono(file)
  if (isCancelled?.()) return null

  const alignmentLanguage = detectSheetLanguage(sheetTexts, lyrics.sourceLanguage)
  const sliceTx = createSliceTranscriber({
    audioData: data,
    sampleRate,
    isCancelled: () => isCancelled?.() ?? false,
    highAccuracy,
    timestampMode,
  })

  const result = await reanalyzeGaps({
    refined,
    transcriptWords: words,
    sheetRows,
    alignmentLanguage,
    sourceLanguage: lyrics.sourceLanguage,
    transcribeSlice: sliceTx.transcribe,
    isCancelled,
    refineOpts: { lyricsBase: lyrics },
    onProgress,
  })

  // applyRefinedAlignment doesn't carry transcriptWords — thread the recovered
  // timeline (and the version stamp) through the lyrics arg (mirrors AutoAlignFlow).
  // The stamp is applied regardless of filledCount so auto never re-runs.
  let recovered = applyRefinedAlignment(
    {
      ...lyrics,
      transcriptWords: result.transcriptWords,
      gapRecoveryVersion: GAP_RECOVERY_VERSION,
    },
    result.refined,
  )

  // The reconstruction + apply operate on the sheet/alignment view; if the song
  // was displaying sung phrases, re-project so recovery keeps the user's layout
  // (its rows now carry the recovered timing via the synced phrases).
  if (lyrics.phraseLayout === 'sung' && (recovered.phrases?.length ?? 0) > 0) {
    recovered = applySungLayout(recovered)
  }

  return { lyrics: recovered, filledCount: result.filledCount }
}
