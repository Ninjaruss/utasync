interface Props {
  /** Active flagged line to anchor, or null to render nothing. */
  lineIndex: number | null
  /** Reads the current playhead time (seconds) at tap moment. */
  getTime: () => number
  /** Called with (lineIndex, capturedTime) when the user taps. */
  onAnchor: (lineIndex: number, time: number) => void
}

/** One-tap anchor affordance: shown in Play mode over a needs_review line. The
 * user taps right when the line starts; the surrounding lines re-fit around it. */
export function TapAnchorPrompt({ lineIndex, getTime, onAnchor }: Props) {
  if (lineIndex === null) return null
  return (
    <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 flex items-center gap-3">
      <p className="text-[11px] text-white/55 text-pretty leading-snug flex-1">
        This line’s timing is uncertain — tap right when it starts and the rest re-fits automatically.
      </p>
      <button
        type="button"
        onClick={() => onAnchor(lineIndex, getTime())}
        className="px-2.5 py-1.5 rounded-lg bg-cinnabar-accent text-white text-[11px] font-medium min-h-8 touch-manipulation shrink-0"
      >
        Tap when this line starts
      </button>
    </div>
  )
}
