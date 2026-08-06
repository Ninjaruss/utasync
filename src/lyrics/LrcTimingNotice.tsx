import { pastedLrcTimedLines } from '../sources/songBuilder'

interface Props {
  pasted: string
  ignored: boolean
  onAlignFromScratch: () => void
}

/**
 * Quiet, dismissible note shown when a paste is a timed LRC whose timings will
 * actually be used (mirrors linesFromPaste's decision exactly via
 * pastedLrcTimedLines). The "Align from scratch instead" button flips the
 * caller's ignoreLrcTimings flag so the paste resolves as plain text. Renders
 * nothing when the timings would not be used or the override is set.
 */
export function LrcTimingNotice({ pasted, ignored, onAlignFromScratch }: Props) {
  const timed = ignored ? null : pastedLrcTimedLines(pasted)
  if (!timed) return null
  return (
    <p className="text-[11px] text-white/50 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>⏱ Using your pasted timings ({timed.length} lines)</span>
      <button
        type="button"
        onClick={onAlignFromScratch}
        className="underline text-white/60 hover:text-white/70 touch-manipulation"
      >
        Align from scratch instead
      </button>
    </p>
  )
}
