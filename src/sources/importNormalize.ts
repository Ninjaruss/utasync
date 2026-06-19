import { findSecondLanguageLyrics } from './lrclib'
import { smartAttachSecondLanguage } from '../lyrics/lineAligner'
import { detectLanguage } from '../lyrics/bilingual'
import type { TimedLine } from '../core/types'

/** Best-effort second-language pairing during import; skips silently on miss or mismatch. */
export async function normalizeImportedLines(
  title: string,
  artist: string,
  lines: TimedLine[],
): Promise<TimedLine[]> {
  const primaryLang = detectLanguage(lines.map((l) => l.original).join('\n'))
  const langParam = primaryLang === 'ja' ? 'ja' : 'other'
  try {
    const second = await findSecondLanguageLyrics(title.trim(), artist.trim(), langParam)
    if (!second) return lines
    const result = await smartAttachSecondLanguage(lines, second.lrc)
    if (result.mismatchedBlocks.length === 0) return result.lines
    return lines
  } catch {
    return lines
  }
}
