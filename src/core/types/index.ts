export type Language = 'ja' | 'en'
export type AlignmentMode = 'manual' | 'auto'
export type PhoneticMode = 'none' | 'reading' | 'translation'
export type ClozeDifficulty = 'easy' | 'medium' | 'hard'
export type DeviceTier = 'full' | 'lite' | 'manual'
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'loading'

export interface Token {
  surface: string
  reading?: string
  pos?: string
  startIndex: number
  endIndex: number
  alignmentIndices?: number[]
}

export interface GrammarAnnotation {
  tokenIndices: number[]
  pattern: string
  explanation: string
}

export interface TimedLine {
  startTime: number
  endTime: number
  original: string
  translation: string
  tokens?: Token[]
  reading?: string
  grammarAnnotations?: GrammarAnnotation[]
}

export interface LyricsData {
  lines: TimedLine[]
  sourceLanguage: Language
  translationLanguage: Language
  alignmentMode: AlignmentMode
  // Confidence of the last auto-alignment (0–1, content-match coverage). When
  // low, auto-align fell back to the proportional method; the UI warns the user.
  alignmentConfidence?: number
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
  isTrialSong: boolean
}

export interface UserSettings {
  proLicense: string | null
  isPro: boolean
  trialSongsClaimed: number
  deviceFingerprint: string
  theme: 'light' | 'dark'
  defaultSpeed: number
  clozeDifficulty: ClozeDifficulty
}

export interface ABLoop {
  a: number | null
  b: number | null
  preRoll: number
  loopCount: number
  crossfadeDuration: number
}
