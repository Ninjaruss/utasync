export type Language = 'ja' | 'en'
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
  /** Set after token enrichment is persisted; avoids re-tokenizing on every open. */
  enrichmentVersion?: number
  /** Sanitized Whisper word timeline from the last auto-align (furigana verification). */
  transcriptWords?: TimedTranscriptWord[]
  /** Per-line start anchor from the last content align, kept so the phrase layer can
   * be re-derived faithfully on open (Phase 5). */
  anchorSources?: ('lcs' | 'interpolated' | 'interjection')[]
  /** Per-line quality from the last validation pass (same order as `lines`). */
  lineAlignmentQuality?: LineAlignmentQuality[]
  /** Canonical sung units derived after auto-align (Phase 1). Optional until derived;
   * the UI keeps rendering `lines` by default (D1 hybrid). */
  phrases?: SungPhrase[]
  /** Which rows the UI renders. 'sheet' (default) = pasted lines; 'sung' = phrases. */
  phraseLayout?: 'sheet' | 'sung'
  /** The pasted-layout rows captured when switching to 'sung', so the user can
   * one-tap restore their original sheet (Phase 3). */
  sheetLinesSnapshot?: TimedLine[]
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
  syncState?: SyncState
}

export interface UserSettings {
  theme: 'light' | 'dark'
  defaultSpeed: number
  clozeDifficulty: ClozeDifficulty
  /** Primary lyric language for new songs and online lyric search. */
  defaultSongLanguage: Language
  /** Isolate vocals with Demucs before Whisper (full-tier only, slower). */
  vocalSeparationEnabled: boolean
  /** Whether detected sung readings are promoted into furigana ruby (D3). */
  readingMode: ReadingMode
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
