import { DragRetimeStrip } from './DragRetimeStrip'
import { type Peaks } from './waveformPeaks'

interface Props {
  /** The first sung line — the one the user lines up against the audio. */
  lineIndex: number
  lineText?: string
  startSec: number
  peaks?: Peaks | null
  waveformState?: 'pending' | 'ready' | 'unavailable'
  positionSec?: number
  onPreview: (timeSec: number) => void
  /** `clamped` means the thumb hit the window edge — the real difference is
   * bigger than a single shift can express, so the caller escalates instead. */
  onCommit: (lineIndex: number, timeSec: number, opts: { clamped: boolean }) => void
  /** Escape hatch: transcribe the audio properly instead. */
  onUseFullAlignment: () => void
}

/**
 * Fast path for a song that arrived with synced lyrics.
 *
 * Those timings already describe this recording to within a median 0.24-0.73s
 * once one constant offset is removed — they are the same master, shifted. That
 * constant cannot be found acoustically (two estimators were measured and both
 * missed by ~0.8s), but the user can place it in a single drag and HEAR whether
 * it lands, because dragging seeks the audio as it goes.
 */
export function OffsetAlignScreen({
  lineIndex, lineText, startSec, peaks, waveformState, positionSec,
  onPreview, onCommit, onUseFullAlignment,
}: Props) {
  return (
    <div
      data-testid="offset-align"
      className="fixed inset-0 z-50 flex flex-col bg-cinnabar-950 overflow-hidden"
    >
      <div className="px-4 pt-5 pb-3 shrink-0">
        <h2 className="text-white font-semibold text-lg">Line up the first line</h2>
        <p className="text-white/65 text-sm mt-1 text-pretty">
          We found synced lyrics for this song. Drag until the first line sits where it is sung —
          you will hear it as you drag. Everything else moves with it.
        </p>
      </div>

      <div className="flex-1 min-h-0 flex items-center">
        <DragRetimeStrip
          lineIndex={lineIndex}
          lineText={lineText}
          startSec={startSec}
          peaks={peaks}
          waveformState={waveformState}
          positionSec={positionSec}
          onPreview={onPreview}
          onCommit={onCommit}
        />
      </div>

      <div className="px-4 pb-6 pt-2 shrink-0">
        <button
          type="button"
          onClick={onUseFullAlignment}
          className="w-full py-2.5 rounded-xl bg-cinnabar-950 border border-cinnabar-800 text-white/80 text-sm min-h-11 hover:bg-cinnabar-800 transition-colors"
        >
          Run full alignment instead
        </button>
        <p className="text-white/45 text-xs mt-2 text-center text-pretty">
          Slower — transcribes the audio. Use this if dragging can&apos;t make the lines fit.
        </p>
      </div>
    </div>
  )
}
