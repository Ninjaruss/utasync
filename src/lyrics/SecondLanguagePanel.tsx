import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { extractSecondLanguageLines, pairsToTimedLines, hasVisibleTranslation } from './bilingual'
import { findSecondLanguageLyrics } from '../sources/lrclib'
import { AlignmentEditor } from './AlignmentEditor'
import { smartAttachSecondLanguage } from './lineAligner'
import { ProgressOverlay } from '../core/ui/ProgressOverlay'
import { SECOND_LANGUAGE_SEARCH_STATUS } from '../core/ui/progressUtils'
import { SECOND_LANGUAGE_ALIGN_STEPS, SECOND_LANGUAGE_SEARCH_STEPS } from '../sources/addSongProgress'

interface Props {
  lines: TimedLine[]
  title: string
  artist: string
  sourceLanguage: Language
  onApply: (lines: TimedLine[]) => void
  onClose: () => void
}

type Phase =
  | { kind: 'current' }
  | { kind: 'searching' }
  | { kind: 'confirm'; paired: TimedLine[]; secondary: string }
  | { kind: 'aligning' }
  | { kind: 'align'; originalLines: string[]; translationLines: string[]; extraLines: string[] }
  | { kind: 'paste' }

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'current' })
  const [pasted, setPasted] = useState('')
  const searchCancelledRef = useRef(false)

  const translatedLines = lines.filter((l) => hasVisibleTranslation(l))

  const startSearch = () => {
    searchCancelledRef.current = false
    setPhase({ kind: 'searching' })
    const primaryLang = sourceLanguage === 'ja' ? 'ja' : 'other'
    findSecondLanguageLyrics(title, artist, primaryLang).then((found) => {
      if (searchCancelledRef.current) return
      if (found) route(found.lrc)
      else setPhase({ kind: 'paste' })
    })
  }

  /**
   * Route a secondary block:
   * - Primary already timed → normalize both to the song timeline via attachSecondLanguage.
   * - Primary untimed → semantic NW aligner (capable devices) or flat fallback.
   */
  const route = async (secondary: string) => {
    setPhase({ kind: 'aligning' })
    try {
      const result = await smartAttachSecondLanguage(lines, secondary)
      if (result.mismatchedBlocks.length === 0) {
        setPhase({ kind: 'confirm', paired: result.lines, secondary })
        return
      }
      const origLines = lines.map((l) => l.original)
      setPhase({
        kind: 'align',
        originalLines: origLines,
        translationLines: result.lines.map((l) => l.translation),
        extraLines: [],
      })
    } catch {
      const transLines = extractSecondLanguageLines(secondary)
      setPhase({
        kind: 'align',
        originalLines: lines.map((l) => l.original),
        translationLines: transLines,
        extraLines: [],
      })
    }
  }

  useEffect(() => {
    if (phase.kind !== 'searching') return
    return () => { searchCancelledRef.current = true }
  }, [phase.kind])

  if (phase.kind === 'aligning') {
    return (
      <ProgressOverlay
        steps={SECOND_LANGUAGE_ALIGN_STEPS}
        currentStepIndex={0}
        taskStatus="Matching translation lines to your lyrics…"
      />
    )
  }

  if (phase.kind === 'align') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-cinnabar-950 overflow-hidden">
        <AlignmentEditor
          originalLines={phase.originalLines}
          translationLines={phase.translationLines}
          extraLines={phase.extraLines}
          onConfirm={(pairs) => { onApply(pairsToTimedLines(lines, pairs)); onClose() }}
        />
      </div>
    )
  }

  return (
    <>
      {phase.kind === 'searching' && (
        <ProgressOverlay
          steps={SECOND_LANGUAGE_SEARCH_STEPS}
          currentStepIndex={0}
          taskStatus={SECOND_LANGUAGE_SEARCH_STATUS.search}
          action={
            <button
              onClick={() => {
                searchCancelledRef.current = true
                setPhase({ kind: 'paste' })
              }}
              className="mt-2 w-full min-h-11 px-4 py-2 rounded-lg border border-white/20 text-white/70 text-xs hover:text-white hover:border-white/40 touch-manipulation transition-[color,border-color] duration-150 ease-out"
            >
              Skip and paste lyrics
            </button>
          }
        />
      )}
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-cinnabar-900 border border-cinnabar-800 p-4 flex flex-col max-h-[min(90dvh,28rem)] overflow-hidden">
        <div className="flex items-center justify-between shrink-0 mb-3">
          <h2 className="text-white font-semibold">Second language</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/40 min-h-11 min-w-11 flex items-center justify-center">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {phase.kind === 'current' && (
          <div className="space-y-3">
            {translatedLines.length > 0 ? (
              <>
                <p className="text-white/70 text-sm">Current second-language lyrics</p>
                <ul className="space-y-1 max-h-48 overflow-y-auto rounded-lg bg-cinnabar-950 border border-cinnabar-800 p-2">
                  {translatedLines.slice(0, 6).map((l, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-white/70 font-jp">{l.original}</span>
                      <span className="text-white/35 italic block">{l.translation}</span>
                    </li>
                  ))}
                  {translatedLines.length > 6 && (
                    <li className="text-[10px] text-white/30">+{translatedLines.length - 6} more…</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="text-white/50 text-sm">No second-language lyrics attached yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={startSearch}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm min-h-11"
              >
                {translatedLines.length > 0 ? 'Replace from LRCLIB' : 'Search LRCLIB'}
              </button>
              <button
                onClick={() => setPhase({ kind: 'paste' })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm min-h-11"
              >
                Paste lyrics
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'confirm' && (
          <div className="space-y-3">
            <p className="text-white/70 text-sm">Does this pairing look right?</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto rounded-lg bg-cinnabar-950 border border-cinnabar-800 p-2">
              {phase.paired.slice(0, 4).map((l, i) => (
                <li key={i} className="text-xs">
                  <span className="text-white/70 font-jp">{l.original}</span>
                  <span className="text-white/35 italic block">{l.translation || '—'}</span>
                </li>
              ))}
              {phase.paired.length > 4 && (
                <li className="text-[10px] text-white/30">+{phase.paired.length - 4} more…</li>
              )}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { onApply(phase.paired); onClose() }}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm min-h-11">Looks good</button>
              <button onClick={() => {
                const origLines = phase.paired.map((l) => l.original)
                const transLines = phase.paired.map((l) => l.translation)
                setPhase({ kind: 'align', originalLines: origLines, translationLines: transLines, extraLines: [] })
              }} className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm min-h-11">Fix pairings</button>
              <button onClick={() => setPhase({ kind: 'paste' })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm min-h-11">Use different / paste</button>
            </div>
          </div>
        )}

        {phase.kind === 'paste' && (
          <div className="space-y-3 flex flex-col min-h-0">
            <p className="text-white/50 text-xs shrink-0">Paste the translation or an LRC block — one line per row.</p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste second-language lyrics or an LRC block, one line per row…"
              rows={5}
              className="w-full flex-1 min-h-[6rem] px-3 py-2 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30 font-jp resize-y"
            />
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => pasted.trim() && route(pasted)}
                disabled={!pasted.trim()}
                className="flex-1 min-w-[8rem] py-2.5 rounded-xl bg-cinnabar-accent text-white text-sm font-medium disabled:opacity-40 min-h-11"
              >
                Attach
              </button>
              <button
                onClick={() => setPhase({ kind: 'current' })}
                className="px-3 py-2.5 rounded-xl bg-cinnabar-900 text-white/70 text-sm min-h-11"
              >
                Back
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
    </>
  )
}
