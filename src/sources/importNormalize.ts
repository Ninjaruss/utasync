import { findSecondLanguageLyrics } from './secondLanguageResolver'
import { smartAttachSecondLanguage } from '../lyrics/lineAligner'
import { detectLanguage } from '../lyrics/bilingual'
import type { TimedLine } from '../core/types'

/** LRCLIB only + fast pairing — keeps save/import under a few seconds. */
const IMPORT_SECOND_LANGUAGE_SEARCH = {
  skipLyricsOvh: true,
} as const

const IMPORT_ATTACH_OPTIONS = {
  preferFast: true,
} as const

/** Best-effort second-language pairing during import; skips silently on miss or mismatch. */
export async function normalizeImportedLines(
  title: string,
  artist: string,
  lines: TimedLine[],
): Promise<TimedLine[]> {
  const primaryLang = detectLanguage(lines.map((l) => l.original).join('\n'))
  const langParam = primaryLang === 'ja' ? 'ja' : 'other'
  try {
    const second = await findSecondLanguageLyrics(
      title.trim(),
      artist.trim(),
      langParam,
      undefined,
      undefined,
      undefined,
      IMPORT_SECOND_LANGUAGE_SEARCH,
    )
    if (!second) return lines
    const result = await smartAttachSecondLanguage(lines, second.lrc, undefined, IMPORT_ATTACH_OPTIONS)
    if (result.mismatchedBlocks.length === 0) return result.lines
    return lines
  } catch {
    return lines
  }
}
