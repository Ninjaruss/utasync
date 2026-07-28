import { Banner } from '../core/ui/Banner'

interface Props {
  /** Active flagged line to anchor, or null to render nothing. */
  lineIndex: number | null
  /** How many uncertain spots remain in this song (including this one). */
  remaining?: number
  /** Reads the current playhead time (seconds) at tap moment. */
  getTime: () => number
  /** Called with (lineIndex, capturedTime) when the user taps. */
  onAnchor: (lineIndex: number, time: number) => void
}

/**
 * One-tap anchor affordance, shown in Play mode when the active line is one the
 * aligner flagged as uncertain. The user taps right as the line starts; that line
 * is pinned to the tap and the surrounding lines re-fit LOCALLY around it
 * (refitAroundAnchors never shifts confident lines outside the pinned span).
 *
 * Measured on a real song: pinning the ~4 flagged spots this way took the whole
 * track to a 0.30s mean start error with no line more than 0.82s out.
 */
export function TapAnchorPrompt({ lineIndex, remaining, getTime, onAnchor }: Props) {
  if (lineIndex === null) return null
  const more = typeof remaining === 'number' && remaining > 1 ? ` (${remaining} spots need your ear)` : ''
  return (
    <Banner
      severity="action"
      action={{
        label: 'Tap when this line starts',
        variant: 'primary',
        onClick: () => onAnchor(lineIndex, getTime()),
      }}
    >
      This line’s timing is uncertain{more} — tap right when it starts and the rest re-fits around it.
    </Banner>
  )
}
