import { useRef, type RefObject } from 'react'
import { Overlay } from '../core/ui/Overlay'
import { useFixedAnchorPosition } from '../core/ui/useFixedAnchorPosition'

export interface RepairCandidate {
  text: string
  /** 0-1 similarity to this row's original, from the cached embedder. Used only
   * to ORDER candidates for one row already chosen for inspection — a distinct,
   * easier problem from deciding which rows to flag in the first place. */
  score: number
  /** 'nearby' = another row's current translation; 'unplaced' = a pasted line
   * the fitter could not place anywhere. */
  source: 'nearby' | 'unplaced'
}

interface Props {
  lineIndex: number
  candidates: RepairCandidate[]
  onChoose: (text: string) => void
  onClose: () => void
  /** The row this popover is anchored to, for viewport-fixed positioning. */
  anchorRef?: RefObject<HTMLElement | null>
}

/**
 * Repair surface for one flagged row: a best-first list of candidate
 * translations (nearby rows plus any unplaced pasted lines), tap to swap it
 * in. Styled after TimestampPopover/WordLookupPopover so it reads as the same
 * kind of control as the rest of the editor.
 */
export function TranslationRepairPopover({ lineIndex, candidates, onChoose, onClose, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useFixedAnchorPosition(ref, anchorRef, { estimatedHeightPx: 320 })

  const ranked = [...candidates].sort((a, b) => b.score - a.score)

  return (
    <Overlay
      onClose={onClose}
      placement="anchored"
      // Unlike TimestampPopover, this surface holds no uncommitted draft: closing
      // without choosing just leaves the flagged row exactly as it was, and the
      // popover can be reopened with the same candidate list. Gaining an
      // outside-pointerdown dismiss here is still a behaviour change (no "tap
      // outside" copy advertises it), but it costs nothing to lose — no undo is
      // needed because there is nothing to undo. Kept at the default
      // (dismissOnOutside: true) rather than adding an unrequested behaviour
      // difference from every other anchored dialog in the app.
      role="dialog"
      label={`Fix translation for line ${lineIndex + 1}`}
      panelRef={ref}
      className="z-20 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
    >
      {/* display:contents so this wrapper doesn't break the panel's space-y-2
          child spacing — it exists only to stop a click from reaching whatever
          row-level click handler sits underneath the popover. */}
      <div className="contents" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/60">Choose a translation for this line</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="min-h-8 min-w-8 flex items-center justify-center text-white/60 hover:text-white/80 touch-manipulation"
        >
          <span aria-hidden className="text-sm leading-none">✕</span>
        </button>
      </div>
      {ranked.length === 0 ? (
        <p className="text-xs text-white/55">No candidates found nearby.</p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {ranked.map((c, i) => (
            <li key={`${c.source}-${i}-${c.text}`}>
              <button
                type="button"
                onClick={() => onChoose(c.text)}
                className="w-full text-left px-2.5 py-2 rounded-lg bg-cinnabar-950 border border-cinnabar-800 text-sm text-white/85 hover:border-cinnabar-accent/50 transition-colors touch-manipulation"
              >
                <span className="text-pretty">{c.text}</span>
                {c.source === 'unplaced' && (
                  <span className="ml-2 inline-block align-middle px-1.5 py-0.5 rounded-full bg-cinnabar-800 text-[10px] text-white/60">
                    unplaced
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </Overlay>
  )
}
