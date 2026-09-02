import { useState } from 'react'
import type { TimedLine, Language, LyricsData } from '../core/types'
import { extractSecondLanguageLines, pairsToTimedLines, hasVisibleTranslation } from './bilingual'
import { AlignmentEditor } from './AlignmentEditor'
import { smartAttachSecondLanguage } from './lineAligner'
import { ProgressOverlay } from '../core/ui/ProgressOverlay'
import { SECOND_LANGUAGE_ALIGN_STEPS } from '../sources/addSongProgress'
import { getSecondLanguageSearchSection } from './lyricSiteLinks'
import {
  buildApplyMeta,
  lastTranslatedRowIndex,
  TRANSLATION_PAIRING_VERSION,
  WRONG_SONG_MEAN_CONFIDENCE,
} from './translationRefit'

// Secondary action on the cinnabar-900 panel: a lifted, bordered surface so the
// button reads as a control instead of blending into the panel (accent stays
// for the single primary action). rounded-lg variant is the default; the paste
// phase overrides to rounded-xl inline.
const secondaryPanelBtn =
  'px-3 py-1.5 rounded-lg bg-cinnabar-950 border border-cinnabar-800 text-white/80 text-sm min-h-11 hover:bg-cinnabar-800 transition-colors'
const accentPanelBtn = 'px-3 py-1.5 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-sm min-h-11'

/** Provenance carried alongside a translation fit, so it can be persisted for
 * repair (Task 11) and re-fitting (Task 12) without re-asking the user to paste. */
export interface TranslationApplyMeta {
  source: string
  unplaced: { text: string; afterLineIndex: number }[]
  pairing: NonNullable<LyricsData['translationPairing']>
}

interface Props {
  lines: TimedLine[]
  title: string
  artist: string
  sourceLanguage: Language
  onApply: (lines: TimedLine[], meta?: TranslationApplyMeta) => void
  onClose: () => void
}

type Phase =
  | { kind: 'current' }
  | { kind: 'aligning' }
  | { kind: 'wrong-song'; paired: TimedLine[]; secondary: string; mean: number; meta: TranslationApplyMeta }
  | {
      kind: 'align'
      originalLines: string[]
      translationLines: string[]
      extraLines: string[]
      /** The raw paste this alignment came from, so a manual confirm can
       * persist `translationSource` (IMPORTANT 4) the same way a clean fit does. */
      secondary: string
    }
  | { kind: 'paste' }

// WRONG_SONG_MEAN_CONFIDENCE (below this mean confidence, a fit is probably
// for the wrong song) now lives in translationRefit.ts — imported above — so
// the automatic re-fit (refitStaleTranslation) can share the same gate
// without an import cycle between the two modules. See that constant's own
// doc comment for how 0.3 was measured.

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
      <p className="text-white/60 text-[11px] text-pretty leading-snug">{section.subtitle}</p>
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
        <p className="text-white/60 text-xs text-pretty">
          Add a song title or artist to pre-fill search links.
        </p>
      )}
    </div>
  )
}

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'current' })
  const [pasted, setPasted] = useState('')
  // Real attach progress (chunked embed done/total) and a one-time "model is
  // downloading" flag, so the overlay reflects what's actually happening instead
  // of a static step that looks hung on a slow first-use model download.
  const [alignProgress, setAlignProgress] = useState<{ done: number; total: number } | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const searchSection = getSecondLanguageSearchSection(title, artist, sourceLanguage)

  const translatedLines = lines.filter((l) => hasVisibleTranslation(l))

  const openPaste = () => {
    setPasted('')
    setPhase({ kind: 'paste' })
  }

  /**
 * Route a secondary block:
 * - Timed primary: semantic/slots pairing on primary rows (title lines skipped).
 * - Untimed primary: row pairing; manual review via AlignmentEditor when counts still disagree.
 */
  const route = async (secondary: string) => {
    setPhase({ kind: 'aligning' })
    setAlignProgress(null)
    setModelLoading(false)
    try {
      const result = await smartAttachSecondLanguage(lines, secondary, undefined, {
        songTitle: title,
        artist,
        onModelLoading: () => setModelLoading(true),
        onProgress: (done, total) => {
          setModelLoading(false)
          setAlignProgress({ done, total })
        },
      })
      if (result.mismatchedBlocks.length === 0) {
        // undefined means the fitter declined to pair that row (metadata/header/
        // duplicate), not low confidence — excluded from the mean rather than
        // treated as zero.
        const defined = (result.confidence ?? []).filter(
          (c): c is number => typeof c === 'number',
        )
        const mean = defined.length ? defined.reduce((a, b) => a + b, 0) / defined.length : 1
        const meta = buildApplyMeta(result, secondary, mean)
        if (mean < WRONG_SONG_MEAN_CONFIDENCE) {
          setPhase({ kind: 'wrong-song', paired: result.lines, secondary, mean, meta })
          return
        }
        onApply(result.lines, meta)
        onClose()
        return
      }
      // Prefer the fitter's real extras (IMPORTANT 5) over a rebuilt positional
      // tail — a positional slice can only ever represent lines past the
      // primary's end, so on EQUAL line counts it always shows zero extras even
      // when the fitter reported a genuine mid-song miss. Only fall back to the
      // slice when the fitter path didn't compute extras at all (e.g. the
      // device-tier/index/mismatch fallbacks), so the surplus-lines case (a
      // real count mismatch, no `extras` field) still surfaces its overflow.
      const rawTrans = extractSecondLanguageLines(secondary)
      setPhase({
        kind: 'align',
        originalLines: lines.map((l) => l.original),
        translationLines: result.lines.map((l) => l.translation),
        extraLines: result.extras ?? rawTrans.slice(lines.length),
        secondary,
      })
    } catch {
      const transLines = extractSecondLanguageLines(secondary)
      setPhase({
        kind: 'align',
        originalLines: lines.map((l) => l.original),
        translationLines: transLines,
        extraLines: transLines.slice(lines.length),
        secondary,
      })
    }
  }

  if (phase.kind === 'aligning') {
    return (
      <ProgressOverlay
        steps={SECOND_LANGUAGE_ALIGN_STEPS}
        currentStepIndex={0}
        taskStatus={
          modelLoading
            ? 'Downloading translation model…'
            : alignProgress
              ? `Matching translation lines… (${alignProgress.done}/${alignProgress.total})`
              : 'Matching translation lines to your lyrics…'
        }
        taskProgress={
          alignProgress && alignProgress.total > 0
            ? (alignProgress.done / alignProgress.total) * 100
            : null
        }
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
          onConfirm={(pairs, remainingExtras) => {
            const nextLines = pairsToTimedLines(lines, pairs)
            // Write provenance for the messiest-paste route too (IMPORTANT 4):
            // translationSource so a later re-fit has something to work from,
            // and unplacedTranslations recomputed from what the user actually
            // left unresolved rather than the stale pre-editor snapshot. The
            // pairing is marked userEdited so an automatic re-fit never
            // silently overwrites this hand-built pairing.
            const meta: TranslationApplyMeta = {
              source: phase.secondary,
              unplaced: remainingExtras.map((text) => ({
                text,
                afterLineIndex: lastTranslatedRowIndex(nextLines),
              })),
              pairing: {
                method: 'index',
                meanConfidence: 1,
                flaggedLineCount: nextLines.filter((l) => !hasVisibleTranslation(l)).length,
                version: TRANSLATION_PAIRING_VERSION,
                userEdited: true,
              },
            }
            onApply(nextLines, meta)
            onClose()
          }}
          // Non-destructive exit: 'align' is only ever reached after a paste
          // (route() runs from the paste phase; 'confirm' is downstream of it),
          // so return to the paste step with the pasted text intact — nothing
          // is applied, and the user can edit the paste, re-attach, or Back out.
          onCancel={() => setPhase({ kind: 'paste' })}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-cinnabar-900 border border-cinnabar-800 p-4 flex flex-col max-h-[min(90dvh,28rem)] overflow-hidden">
        <div className="flex items-center justify-between shrink-0 mb-3">
          <h2 className="text-white font-semibold">Second language</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/60 min-h-11 min-w-11 flex items-center justify-center">✕</button>
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
                      <span className="text-white/60 italic block">{l.translation}</span>
                    </li>
                  ))}
                  {translatedLines.length > 6 && (
                    <li className="text-[10px] text-white/55">+{translatedLines.length - 6} more…</li>
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
                  className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-sm min-h-11"
                >
                  Replace translation
                </button>
              )}
              <button
                onClick={openPaste}
                className={translatedLines.length > 0 ? secondaryPanelBtn : accentPanelBtn}
              >
                Paste lyrics
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'wrong-song' && (
          <div className="space-y-3">
            <p className="text-white/70 text-sm">This doesn&apos;t look like a translation of this song.</p>
            <p className="text-white/55 text-xs">
              The pasted lyrics don&apos;t line up well with the original — you may have pasted the
              wrong song, or an unrelated block of text.
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { onApply(phase.paired, phase.meta); onClose() }}
                className={secondaryPanelBtn}>Apply anyway</button>
              <button onClick={openPaste}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-sm min-h-11">Paste different</button>
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
              className="w-full flex-1 min-h-[6rem] px-3 py-2 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/55 font-jp resize-y"
            />
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => pasted.trim() && route(pasted)}
                disabled={!pasted.trim()}
                className="flex-1 min-w-[8rem] py-2.5 rounded-xl bg-cinnabar-accent text-cinnabar-950 text-sm font-medium disabled:opacity-40 min-h-11"
              >
                Attach
              </button>
              <button
                onClick={() => setPhase({ kind: 'current' })}
                className="px-3 py-2.5 rounded-xl bg-cinnabar-950 border border-cinnabar-800 text-white/80 text-sm min-h-11 hover:bg-cinnabar-800 transition-colors"
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
