import type { Language, TimedLine, SungPhrase, LineAlignmentQuality } from '../core/types'
import { enforceLineMonotonicity, type RefinedAlignment } from './phraseAlignment'
import { redistributeDegenerateRuns } from './redistributeDegenerateRuns'
import { qualityRank } from '../ai-pipeline/contentAligner'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

function isLatinLine(text: string): boolean {
  return !JA_SCRIPT_RE.test(text) && (text.match(/[A-Za-z']+/g) ?? []).length >= 1
}

/**
 * Merge a forced-Japanese and a forced-English alignment of the same sheet.
 * Both passes transcribe the same audio, so their times share a clock. For each
 * line, pick the pass matching its script (Latin → EN pass, else JA pass), then
 * take the OTHER pass if the script-selected pass rates the line needs_review but
 * the other rates it better. Smooth pass-boundary seams with the existing
 * monotonicity + (optional) redistribution passes.
 *
 * `wordsForActivity` (optional): the union of both passes' transcript words,
 * giving the redistribution pass activity regions; omitted → monotonicity-only.
 * `alignE === null` → the English pass failed; return the JA alignment as-is.
 */
export function mergeBilingualAlignments(
  sheetRows: TimedLine[],
  alignJ: RefinedAlignment,
  alignE: RefinedAlignment | null,
  sourceLanguage: Language = 'ja',
  wordsForActivity?: TranscriptWord[],
): RefinedAlignment {
  if (!alignE) return alignJ

  const qJ = alignJ.lineAlignmentQuality ?? alignJ.lines.map(() => 'needs_review' as LineAlignmentQuality)
  const qE = alignE.lineAlignmentQuality ?? alignE.lines.map(() => 'needs_review' as LineAlignmentQuality)

  const chosen: Array<'J' | 'E'> = sheetRows.map((row, i) => {
    const text = row.original || row.translation
    const primary: 'J' | 'E' = isLatinLine(text) ? 'E' : 'J'
    const other: 'J' | 'E' = primary === 'J' ? 'E' : 'J'
    const primQ = primary === 'J' ? qJ[i] : qE[i]
    const otherQ = other === 'J' ? qJ[i] : qE[i]
    if (primQ === 'needs_review' && qualityRank(otherQ) > qualityRank(primQ)) return other
    return primary
  })

  const lines: TimedLine[] = sheetRows.map((_, i) =>
    ({ ...(chosen[i] === 'J' ? alignJ.lines[i] : alignE.lines[i]) }))
  const lineAlignmentQuality = sheetRows.map((_, i) => (chosen[i] === 'J' ? qJ[i] : qE[i]))
  const anchorSources = sheetRows.map((_, i) => {
    const src = chosen[i] === 'J' ? alignJ.anchorSources?.[i] : alignE.anchorSources?.[i]
    return src ?? 'interpolated'
  })

  enforceLineMonotonicity(lines)
  let finalLines = lines
  if (wordsForActivity && wordsForActivity.length) {
    // Protect lines we successfully anchored in either pass; only redistribute
    // the needs_review runs (unanchored in BOTH passes) so a good selection
    // can't be re-timed onto the other language's audio (which would also leave
    // a stale 'good' label on a moved line). Mirrors how refineAlignmentWithPhrases
    // passes `phonetic.recovered` as the anchoredMask (true = treat as anchored).
    const anchoredMask = lineAlignmentQuality.map((q) => q !== 'needs_review')
    finalLines = redistributeDegenerateRuns(
      lines, sanitizeTranscript(wordsForActivity), sourceLanguage, anchoredMask,
    ).lines
  }

  const phrases = mergePhrases(alignJ.phrases, alignE.phrases, chosen, finalLines)

  return {
    ...alignJ,
    lines: finalLines,
    phrases,
    anchorSources,
    lineAlignmentQuality,
  }
}

/**
 * Combine the two passes' phrase lists by majority vote: each phrase is kept
 * from whichever pass its source lines were mostly selected from, then re-synced
 * to the merged line times.
 *
 * Correct for the default SHEET layout, where phrases are 1:1 with lines — every
 * line is covered by exactly one phrase and the vote is unambiguous. LIMITATION:
 * in the sung (multi-line) layout J and E can group the same passage into
 * DIFFERENT line-spans, so majority-vote selection may leave gaps or overlaps in
 * coverage. Reconciling divergent multi-line phrase groupings across passes is a
 * follow-up; not handled here.
 */
function mergePhrases(
  phrasesJ: SungPhrase[],
  phrasesE: SungPhrase[],
  chosen: Array<'J' | 'E'>,
  mergedLines: TimedLine[],
): SungPhrase[] {
  const pick = (p: SungPhrase): boolean => {
    const votes = p.sourceLineIndices.reduce((n, li) => n + (chosen[li] === 'E' ? 1 : -1), 0)
    return votes > 0
  }
  const out: SungPhrase[] = []
  for (const p of phrasesJ) if (!pick(p)) out.push(resync(p, mergedLines))
  for (const p of phrasesE) if (pick(p)) out.push(resync(p, mergedLines))
  out.sort((a, b) => a.startTime - b.startTime)
  return out
}

function resync(p: SungPhrase, mergedLines: TimedLine[]): SungPhrase {
  const starts = p.sourceLineIndices.map((i) => mergedLines[i]?.startTime).filter((t): t is number => Number.isFinite(t))
  const ends = p.sourceLineIndices.map((i) => mergedLines[i]?.endTime).filter((t): t is number => Number.isFinite(t))
  if (!starts.length) return p
  return { ...p, startTime: Math.min(...starts), endTime: Math.max(...ends) }
}
