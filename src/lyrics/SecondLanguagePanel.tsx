import { useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { extractSecondLanguageLines, pairsToTimedLines, hasVisibleTranslation } from './bilingual'
import { AlignmentEditor } from './AlignmentEditor'
import { smartAttachSecondLanguage } from './lineAligner'
import { ProgressOverlay } from '../core/ui/ProgressOverlay'
import { SECOND_LANGUAGE_ALIGN_STEPS } from '../sources/addSongProgress'
import { getSecondLanguageSearchSection } from './lyricSiteLinks'

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
  | { kind: 'confirm'; paired: TimedLine[]; secondary: string }
  | { kind: 'aligning' }
  | { kind: 'align'; originalLines: string[]; translationLines: string[]; extraLines: string[] }
  | { kind: 'paste' }

function FindLyricsOnlineSection({
  title,
  artist,
  sourceLanguage,
}: {
  title: string
  artist: string
  sourceLanguage: Language
}) {
  const section = getSecondLanguageSearchSection(title, artist, sourceLanguage)
  const hasMetadata = Boolean(title.trim() || artist.trim())

  return (
    <div className="rounded-lg border border-cinnabar-800/80 bg-cinnabar-950/60 p-2.5 space-y-2">
      <p className="text-white/50 text-xs text-pretty">{section.title}</p>
      <p className="text-white/35 text-[11px] text-pretty leading-snug">{section.subtitle}</p>
      {hasMetadata ? (
        <ul className="space-y-1.5">
          {section.links.map((link) => (
            <li key={link.id}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cinnabar-accent text-sm hover:underline underline-offset-2 touch-manipulation"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-white/35 text-xs text-pretty">
          Add a song title or artist to pre-fill search links.
        </p>
      )}
    </div>
  )
}

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'current' })
  const [pasted, setPasted] = useState('')
  const searchSection = getSecondLanguageSearchSection(title, artist, sourceLanguage)

  const translatedLines = lines.filter((l) => hasVisibleTranslation(l))

  const openPaste = () => {
    setPasted('')
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
      setPhase({
        kind: 'align',
        originalLines: lines.map((l) => l.original),
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
            <FindLyricsOnlineSection title={title} artist={artist} sourceLanguage={sourceLanguage} />
            <div className="flex flex-wrap gap-2">
              {translatedLines.length > 0 && (
                <button
                  onClick={openPaste}
                  className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm min-h-11"
                >
                  Replace translation
                </button>
              )}
              <button
                onClick={openPaste}
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
              <button onClick={openPaste}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm min-h-11">Use different / paste</button>
            </div>
          </div>
        )}

        {phase.kind === 'paste' && (
          <div className="space-y-3 flex flex-col min-h-0">
            <FindLyricsOnlineSection title={title} artist={artist} sourceLanguage={sourceLanguage} />
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={searchSection.pasteHint}
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
  )
}
