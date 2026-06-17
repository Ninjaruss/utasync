import { useEffect, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { attachSecondLanguage, extractSecondLanguageLines, pairsToTimedLines } from './bilingual'
import { findSecondLanguageLyrics } from '../sources/lrclib'
import { AlignmentEditor } from './AlignmentEditor'

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
  | { kind: 'align'; secondary: string }
  | { kind: 'paste' }

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'searching' })
  const [pasted, setPasted] = useState('')

  // Route a secondary block to confirm (counts match) or align (counts differ).
  const route = (secondary: string) => {
    const { lines: paired, needsAlignment } = attachSecondLanguage(lines, secondary)
    setPhase(needsAlignment ? { kind: 'align', secondary } : { kind: 'confirm', paired, secondary })
  }

  useEffect(() => {
    let cancelled = false
    // findSecondLanguageLyrics expects 'ja' | 'other'; Song stores 'ja' | 'en'.
    const primaryLang = sourceLanguage === 'ja' ? 'ja' : 'other'
    findSecondLanguageLyrics(title, artist, primaryLang).then((found) => {
      if (cancelled) return
      if (found) route(found.lrc)
      else setPhase({ kind: 'paste' })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase.kind === 'align') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-cinnabar-950">
        <AlignmentEditor
          originalLines={lines.map((l) => l.original)}
          translationLines={extractSecondLanguageLines(phase.secondary)}
          onConfirm={(pairs) => { onApply(pairsToTimedLines(lines, pairs)); onClose() }}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-cinnabar-950 border border-cinnabar-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Second language</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/40 px-2">✕</button>
        </div>

        {phase.kind === 'searching' && (
          <p className="text-white/50 text-sm py-6 text-center">Searching LRCLIB…</p>
        )}

        {phase.kind === 'confirm' && (
          <div className="space-y-3">
            <p className="text-white/70 text-sm">Found translation from LRCLIB — does it look right?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { onApply(phase.paired); onClose() }}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm">Looks good</button>
              <button onClick={() => setPhase({ kind: 'align', secondary: phase.secondary })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Fix pairings</button>
              <button onClick={() => setPhase({ kind: 'paste' })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Use different / paste</button>
            </div>
          </div>
        )}

        {phase.kind === 'paste' && (
          <div className="space-y-3">
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
  )
}
