// Type-only, so this is erased at build time: no runtime coupling from core to
// the pipeline, and no import cycle. vocalActivity.ts depends on nothing but its
// own FFT helpers.
import type { VocalActivitySignal } from '../../ai-pipeline/vocalActivity'

export type Language = 'ja' | 'en'
/** Language the alignment pipeline operates in. Unlike the stored song
 * `Language`, this is detected from the lyric sheet itself so an English or
 * code-switching sheet aligns correctly even when the song metadata defaulted
 * to 'ja'. 'mixed' means the sheet alternates JA and Latin sections. */
export type AlignmentLanguage = Language | 'mixed'
export type AlignmentMode = 'manual' | 'auto'
export type FuriganaMode = 'none' | 'romaji' | 'furigana'
export type LyricsLayout = 'stacked' | 'sideBySide'
export type ClozeDifficulty = 'easy' | 'medium' | 'hard'
export type DeviceTier = 'full' | 'lite' | 'manual'
/** Furigana reading source preference. 'dictionary' keeps dictionary readings in
 * ruby and only surfaces sung alternates in the tooltip; 'sung' promotes detected
 * sung readings into the ruby whenever the audio supplies one. */
export type ReadingMode = 'dictionary' | 'sung'
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'loading'

export type ProviderType = 'youtube' | 'spotify' | 'upload'

export interface SourceRef {
  provider: ProviderType
  /** youtube videoId | spotify trackId | OPFS audio path */
  ref: string
  url?: string
  /** true when the app can decode local audio for AI align / export (upload only) */
  hasAudio: boolean
}

export type SyncState = 'synced' | 'needs-sync'

export interface Token {
  surface: string
  reading?: string
  pos?: string
  /** kuromoji pos_detail_1 (e.g. 非自立 for dependent verb stems). */
  posDetail1?: string
  /** Kuromoji dictionary (lemma) form when it differs from the surface (泣い → 泣く). */
  baseForm?: string
  startIndex: number
  endIndex: number
  alignmentIndices?: number[]
  /** Katakana reading adopted from aligned audio when it differs from the dictionary. */
  audioReading?: string
  /** True when the audio transcript disagrees with the dictionary reading. */
  readingMismatch?: boolean
  /** True when aligned audio matches the dictionary reading for this token. */
  readingVerified?: boolean
  /** Confidence (0–1) that an adopted `audioReading` alternate is correct. Set by
   * the reading reconciler; only alternates at/above the high threshold (or when
   * the user prefers sung readings) are promoted into the ruby. */
  readingConfidence?: number
}

export interface GrammarAnnotation {
  tokenIndices: number[]
  pattern: string
  explanation: string
}

export interface TimedTranscriptWord {
  word: string
  startTime: number
  endTime: number
}

export interface TimedLine {
  startTime: number
  endTime: number
  original: string
  translation: string
  tokens?: Token[]
  reading?: string
  /** Ruby HTML (kuroshiro furigana) for rendering readings above kanji. */
  furigana?: string
  grammarAnnotations?: GrammarAnnotation[]
  /** Rows sharing an id share ONE translation, rendered once and bracketed
   * across them (a translator folded two sung lines into one thought).
   * Every row in a group carries the SAME `translation` string, so consumers
   * that ignore this field degrade to repeating it — never to a blank row.
   * Absent ⇒ this row is its own group (legacy behavior). */
  translationGroup?: number
  /** 0–1 confidence in this row's translation pairing. Absent ⇒ unflagged. */
  translationConfidence?: number
}

/** How a phrase's timing was anchored. Mirrors LineAnchorSource plus 'manual'. */
export type PhraseAnchorSource = 'lcs' | 'interpolated' | 'interjection' | 'manual'

/** Per-line auto-align quality after the validation pass. */
export type LineAlignmentQuality = 'good' | 'approximate' | 'needs_review'

/** A canonical sung unit derived from timed rows + the audio transcript (Phase 1).
 * Phrases re-group the pasted sheet rows to match how the song is actually sung:
 * one sheet row can split into several phrases, and several rows can merge into one.
 * Derived additively — `lyrics.lines` (the user's sheet) is never rewritten here. */
export interface SungPhrase {
  id: string
  startTime: number
  endTime: number
  original: string
  translation: string
  anchorSource: PhraseAnchorSource
  /** Indices into `lyrics.lines` this phrase was derived from (many-to-many). */
  sourceLineIndices: number[]
  tokens?: Token[]
}

export interface LyricsData {
  lines: TimedLine[]
  sourceLanguage: Language
  translationLanguage: Language
  alignmentMode: AlignmentMode
  // Confidence of the last auto-alignment (0–1, content-match coverage). When
  // low, auto-align fell back to the proportional method; the UI warns the user.
  alignmentConfidence?: number
  /** Bump when auto-align timing logic changes; songs below this re-refine from the
   * stored Whisper transcript on open (no re-transcription). */
  alignmentPipelineVersion?: number
  /** Set once a stored song has been auto-recovered for garbled gaps (round 9,
   * R9-2). SEPARATE from alignmentPipelineVersion: gates the expensive once-on-open
   * gap re-transcription so it runs at most once (stamped even if nothing filled).
   * Manual "Recover N sections" bypasses this. */
  gapRecoveryVersion?: number
  /** Set after token enrichment is persisted; avoids re-tokenizing on every open. */
  enrichmentVersion?: number
  /** Sanitized Whisper word timeline from the last auto-align (furigana verification). */
  transcriptWords?: TimedTranscriptWord[]
  /** Per-line start anchor from the last content align, kept so the phrase layer can
   * be re-derived faithfully on open (Phase 5). */
  anchorSources?: ('lcs' | 'interpolated' | 'interjection')[]
  /** Per-line quality from the last validation pass (same order as `lines`). */
  lineAlignmentQuality?: LineAlignmentQuality[]
  /** Vocal-activity envelope from the last auto-align, kept so drag re-timing can
   * snap a chosen time onto a real vocal onset without re-running the pipeline.
   *
   * PERSISTED rather than recomputed, because the signal worth snapping to is the
   * STEM one and recomputing that means re-running Demucs (~1.4x audio length —
   * minutes). Recomputing from the raw mix instead is cheap (~430ms decode plus
   * STFT) but the mix is a documented weaker prior, and snapping a vocal entry to
   * a drum transient is worse than not snapping. Measured cost of keeping it:
   * ~42KB raw for a 230s song (~93KB on disk with IndexedDB overhead) against a
   * ~3.7MB mp3 — a couple of percent. Typed arrays survive IndexedDB's structured
   * clone bit-exact; there is no JSON blow-up.
   *
   * Cleared whenever the audio is replaced — a signal describing different audio
   * is worse than none. */
  vocalActivity?: VocalActivitySignal
  /** Hard timing pins from user taps (and any auto start/end edges). Line timing is
   * re-fit locally around these via refitAroundAnchors, and they survive re-align.
   * Absent ⇒ legacy behavior (no pins). */
  timingAnchors?: { lineIndex: number; time: number; source: 'user' | 'auto-start' | 'auto-end' }[]
  /** Canonical sung units derived after auto-align (Phase 1). Optional until derived;
   * the UI keeps rendering `lines` by default (D1 hybrid). */
  phrases?: SungPhrase[]
  /** Which rows the UI renders. 'sheet' (default) = pasted lines; 'sung' = phrases. */
  phraseLayout?: 'sheet' | 'sung'
  /** The pasted-layout rows captured when switching to 'sung', so the user can
   * one-tap restore their original sheet (Phase 3). */
  sheetLinesSnapshot?: TimedLine[]
  /** Pasted translation lines the fitter could not place, with the row they were
   * expected after — so repair can show them in context, not as a nameless tail. */
  unplacedTranslations?: { text: string; afterLineIndex: number }[]
  /** Where the LINE TIMINGS came from, which is what decides whether they might
   * be offset from this particular audio file.
   *   'lrclib'      — fetched from an external catalogue. Same master, but
   *                   typically about a second out (measured median 0.24-0.73s
   *                   after one constant shift), so an adjustment is likely.
   *   'subtitle-file'— a .lrc/.srt/.vtt the user supplied alongside their own
   *                   audio, so very likely already exact.
   *   'aligned'/'tapped' — produced against THIS audio, exact by construction.
   * Absent ⇒ unknown, treated the same as 'subtitle-file' (assume it is fine and
   * stay quiet) rather than nagging about timings that may be perfect. */
  timingSource?: 'lrclib' | 'subtitle-file' | 'aligned' | 'tapped'
  /** The raw pasted translation block, retained so a later fitter improvement can
   * re-fit without asking the user to paste again. `translationPairing.version`
   * is inert without this. */
  translationSource?: string
  /** Summary of the last translation fit. `version` is a CONTENT version for the
   * pairing, independent of the DB schema and of alignmentPipelineVersion. */
  translationPairing?: {
    method: 'index' | 'slots' | 'semantic' | 'timeline' | 'mismatch'
    meanConfidence: number
    flaggedLineCount: number
    version: number
    /** True once the user has hand-edited this pairing (repair popover pick,
     * or an AlignmentEditor confirm). An automatic re-fit is unprompted and
     * must never silently overwrite a hand edit — `refitStaleTranslation`
     * skips entirely when this is set. */
    userEdited?: boolean
  }
}

export interface WordAlignment {
  sourceTokenIndices: number[]
  targetWordIndices: number[]
  lineIndex: number
}

export interface PracticeStats {
  totalPlays: number
  totalLoopTime: number
  clozeAttempts: number
  clozeCorrect: number
  lastPracticed: Date
}

export interface Song {
  id: string
  title: string
  artist: string
  sourceUrl?: string
  audioStoredPath?: string
  lyrics: LyricsData
  alignment?: WordAlignment[]
  stats?: PracticeStats
  createdAt: Date
  // Phase 1: unified source model (additive; derived from sourceUrl/audioStoredPath when absent)
  sources?: SourceRef[]
  activeProvider?: ProviderType
  albumArtUrl?: string
  /** Track length in seconds, when known. Optional: YouTube songs have none until
   * playback reports one, and songs stored before this field existed have none.
   * Feeds version-aware lyric matching — LRCLIB scoring weights duration heavily
   * (+0.15 within 2s, -0.25 for a large mismatch), which is what tells two masters
   * of the same song apart. */
  durationSec?: number
  syncState?: SyncState
}

export interface UserSettings {
  theme: 'light' | 'dark'
  defaultSpeed: number
  clozeDifficulty: ClozeDifficulty
  /** Primary lyric language for new songs and online lyric search. */
  defaultSongLanguage: Language
  /** Isolate vocals with Demucs before Whisper (full-tier only, slower).
   * Tri-state: `null` means "use the default" (on when the device supports it —
   * isolation is the highest-impact accuracy lever and is guarded by a stem
   * sanity-check that falls back to the mix); `true`/`false` are explicit user
   * choices and are always honored. */
  vocalSeparationEnabled: boolean | null
  /** Whether detected sung readings are promoted into furigana ruby (D3). */
  readingMode: ReadingMode
  /** Tap a lyric word to open the built-in dictionary popover. Off lets desktop Yomitan users avoid double popups. */
  tapLookupEnabled: boolean
  /** The user consented once to the first ~240MB speech-model download. Gates the
   * first-run download prompt in Auto-Align so a fresh install can't silently pull
   * a large model on the first song. */
  modelDownloadConsented: boolean
}

export interface ABLoop {
  a: number | null
  b: number | null
  preRoll: number
  loopCount: number
  crossfadeDuration: number
}

/** Saved A–B segment for loop playlists (per song). */
export interface ABLoopPlaylistEntry {
  id: string
  a: number
  b: number
  label?: string
}
