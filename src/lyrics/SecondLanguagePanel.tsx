import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { extractSecondLanguageLines, pairsToTimedLines } from './bilingual'
import { findSecondLanguageLyrics } from '../sources/lrclib'
import { AlignmentEditor } from './AlignmentEditor'
import { smartAttachSecondLanguage } from './lineAligner'
import { LoadingOverlay } from '../core/ui/LoadingOverlay'

interface Props {
  lines: TimedLine[]
  title: string
  artist: string
  sourceLanguage: Language
  onApply: (lines: TimedLine[]) => void
  onClose: () => void
}

type Phase =
  | { kind: 'searching' }
  | { kind: 'confirm'; paired: TimedLine[]; secondary: string }
  | { kind: 'aligning' }
  | { kind: 'align'; originalLines: string[]; translationLines: string[]; extraLines: string[] }
  | { kind: 'paste' }

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'searching' })
  const [pasted, setPasted] = useState('')
  const searchSkippedRef = useRef(false)

  const skipSearch = () => {
    searchSkippedRef.current = true
    setPhase({ kind: 'paste' })
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
    let cancelled = false
    searchSkippedRef.current = false
    // findSecondLanguageLyrics expects 'ja' | 'other'; Song stores 'ja' | 'en'.
    const primaryLang = sourceLanguage === 'ja' ? 'ja' : 'other'
    findSecondLanguageLyrics(title, artist, primaryLang).then((found) => {
      if (cancelled || searchSkippedRef.current) return
      if (found) route(found.lrc)
      else setPhase({ kind: 'paste' })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase.kind === 'aligning') {
    return (
      <LoadingOverlay
        message="Normalizing lyrics…"
        detail="Matching translation lines to your lyrics"
      />
    )
  }

  if (phase.kind === 'align') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-cinnabar-950">
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
        <LoadingOverlay
          message="Searching LRCLIB…"
          detail="Looking for a second-language lyric file by title and artist"
          action={
            <button
              onClick={skipSearch}
              className="mt-2 px-4 py-2 rounded-lg border border-white/20 text-white/70 text-xs hover:text-white hover:border-white/40"
            >
              Skip and paste lyrics
            </button>
          }
        />
      )}
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-cinnabar-900 border border-cinnabar-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Second language</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/40 px-2">✕</button>
        </div>

        {phase.kind === 'searching' && (
          <p className="text-white/35 text-xs text-center py-6">Searching LRCLIB…</p>
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
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm">Looks good</button>
              <button onClick={() => {
                const origLines = phase.paired.map((l) => l.original)
                const transLines = phase.paired.map((l) => l.translation)
                setPhase({ kind: 'align', originalLines: origLines, translationLines: transLines, extraLines: [] })
              }} className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Fix pairings</button>
              <button onClick={() => setPhase({ kind: 'paste' })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Use different / paste</button>
            </div>
          </div>
        )}

        {phase.kind === 'paste' && (
          <div className="space-y-3">
            <p className="text-white/50 text-xs">Paste the translation or an LRC block — one line per row.</p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste second-language lyrics or an LRC block, one line per row…"
              rows={6}
              className="w-full px-3 py-2 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30 font-jp"
            />
            <button
              onClick={() => pasted.trim() && route(pasted)}
              disabled={!pasted.trim()}
              className="w-full py-2 rounded-xl bg-cinnabar-accent text-white text-sm font-medium disabled:opacity-40"
            >
              Attach
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
