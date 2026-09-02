import { useRef } from 'react'
import { DragRetimeStrip } from './DragRetimeStrip'
import { type Peaks } from './waveformPeaks'
import { useModalDialog } from '../core/ui/useModalDialog'

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
  /** Leave the timings exactly as they arrived and go to the player. */
  onKeepTimings: () => void
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
  onPreview, onCommit, onUseFullAlignment, onKeepTimings,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  /* Escape maps to KEEPING the timings, never to committing a drag or kicking off
   * a transcription: this screen opens by itself after a song is added, so the
   * one thing an accidental keypress must not do is change timings the user never
   * asked to change. */
  useModalDialog(ref, onKeepTimings)

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Line up the first line"
      data-testid="offset-align"
      className="fixed inset-0 z-50 flex flex-col bg-cinnabar-950 overflow-hidden"
    >
      <div className="px-4 pt-5 pb-3 shrink-0">
        {/* This screen is a full-bleed overlay that opens on its own after a song
            is added, and it covers the app header — so without this the only ways
            out were to commit a drag or to start a multi-minute transcription.
            Lyrics that arrive already correct (the case this whole fast path
            exists for) had no "leave them alone" answer. */}
        <button
          type="button"
          onClick={onKeepTimings}
          className="min-h-11 -ml-2 px-2 text-white/60 hover:text-white text-sm touch-manipulation transition-colors duration-150"
        >
          ← Timings look right
        </button>
        <h2 className="text-white font-semibold text-lg mt-1">Line up the first line</h2>
        <p className="text-white/65 text-sm mt-1 text-pretty">
          We found synced lyrics for this song. Drag until the first line sits where it is sung —
          you will hear it as you drag. Everything else moves with it.
        </p>
      </div>

      {/* Column, not row. DragRetimeStrip's root carries `shrink-0`, which in a
          ROW flex container means "size to your content" — so the whole control
          collapsed to ~286px against the left edge of a 1280px screen with the
          rest of the row empty. Its home in PlayerView is a column flex, where
          the same class means "don't shrink vertically" and it stretches wide.
          `justify-center` keeps the vertical centring this had. */}
      <div className="flex-1 min-h-0 flex flex-col justify-center">
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
