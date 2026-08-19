import { peaksWindow, type Peaks } from './waveformPeaks'

/** Columns in the waveform. Finer than the strip is ever drawn, so never blocky. */
const WAVE_COLUMNS = 220

/**
 * Build the waveform as a single filled path: one `M x y h w v h h-w Z` subpath per
 * column.
 *
 * One path rather than 220 elements. The window is frozen while a value is being
 * dragged, so the columns are identical on every step — 220 elements per render was
 * allocation and reconciliation bought for nothing, on the interaction whose
 * smoothness is the point. Filled subpaths, not a stroke: `preserveAspectRatio
 * ="none"` scales the axes unevenly, which would distort a stroke width but not a
 * fill.
 *
 * The height floor keeps near-silence drawing a hairline — a flat gap in the middle
 * of a waveform reads as broken rather than as quiet.
 */
function waveformPath(columns: Float32Array): string {
  let d = ''
  for (let i = 0; i < columns.length; i++) {
    const h = Math.max(1.5, columns[i] * 88)
    d += `M${(i + 0.15).toFixed(2)} ${(50 - h / 2).toFixed(2)}h0.7v${h.toFixed(2)}h-0.7Z`
  }
  return d
}

export interface WaveformMarker {
  timeSec: number
  /** Shown on a tab attached to the marker. Omit for a bare reference line. */
  label?: string
  /** 'primary' is the value being positioned; 'muted' is context (a neighbour). */
  variant?: 'primary' | 'muted'
  /** Which way the label tab opens. 'auto' points the way time runs. */
  opens?: 'auto' | 'left'
}

interface Props {
  peaks?: Peaks | null
  /** Why there is no waveform yet, so the strip can say which. */
  waveformState?: 'pending' | 'ready' | 'unavailable'
  minSec: number
  maxSec: number
  /** Shaded spans — a loop being played, or the extent of a line. */
  regions?: { startSec: number; endSec: number }[]
  markers?: WaveformMarker[]
  /** Live playhead, drawn dashed so it never reads as a second boundary marker. */
  positionSec?: number
  className?: string
}

/**
 * The audio for one time window, with markers on its own axis.
 *
 * Shared by the Play-mode re-timing strip and the Edit-mode timestamp editor,
 * because they are the same problem: positioning a moment against a sound. Timing by
 * ear alone gives the eye nothing to aim at, and an abstract track of tick marks
 * shows you WHERE a value sits relative to its neighbours without showing you what
 * is actually there to line it up with.
 *
 * Markers are drawn here rather than aligned to a native range thumb on purpose: the
 * thumb is drawn by the browser at a browser-defined size, so anything aligned to it
 * in Chromium drifts in Gecko. Owning the geometry means the mark you drag and the
 * transient you are aiming at cannot disagree.
 */
export function WaveformStrip({
  peaks, waveformState, minSec, maxSec, regions, markers, positionSec, className,
}: Props) {
  const span = maxSec - minSec
  const at = (t: number) => (span > 0 ? Math.min(1, Math.max(0, (t - minSec) / span)) : 0)
  // Whether we HAVE audio to draw, which is not the same as whether this window
  // happens to contain any. A silent stretch draws as the hairline floor — "quiet
  // here" — because telling the user their track has no waveform when they are
  // simply between sounds is a lie about their audio.
  const canDraw = waveformState === 'ready' && peaks != null && peaks.data.length > 0
  const playheadVisible =
    typeof positionSec === 'number' && positionSec >= minSec && positionSec <= maxSec

  return (
    <div className={`relative rounded-md bg-black/30 overflow-hidden ring-1 ring-white/5 ${className ?? 'h-16'}`}>
      {canDraw ? (
        <svg
          viewBox={`0 0 ${WAVE_COLUMNS} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          {regions?.map((r, i) => (
            <rect
              key={i}
              x={at(r.startSec) * WAVE_COLUMNS}
              width={Math.max(0.5, (at(r.endSec) - at(r.startSec)) * WAVE_COLUMNS)}
              y="0" height="100" className="fill-white/[0.06]"
            />
          ))}
          <path className="fill-white/35" d={waveformPath(peaksWindow(peaks, minSec, maxSec, WAVE_COLUMNS))} />
        </svg>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/35">
          {waveformState === 'pending' ? 'Reading the audio…' : 'No waveform for this track'}
        </div>
      )}

      {playheadVisible ? (
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px"
          style={{
            left: `${at(positionSec!) * 100}%`,
            backgroundImage:
              'repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0 3px, transparent 3px 6px)',
          }}
        />
      ) : null}

      {markers?.map((m, i) => {
        const muted = m.variant === 'muted'
        // The tab normally opens the way time runs. Near the right edge that would be
        // clipped by the container, so it flips and keeps its meaning through the
        // arrow rather than through position. One threshold serves every width, which
        // is why labels are kept short.
        const opensLeft = m.opens === 'left' || at(m.timeSec) > 0.76
        return (
          <span
            key={i}
            aria-hidden="true"
            className={`absolute top-0 bottom-0 w-0.5 -translate-x-1/2 ${muted ? 'bg-white/30' : 'bg-cinnabar-accent'}`}
            style={{ left: `${at(m.timeSec) * 100}%` }}
          >
            {m.label ? (
              <span
                className={`absolute top-0 flex items-center h-[15px] px-1 text-[9px] font-semibold leading-none tracking-wide whitespace-nowrap ${
                  muted ? 'bg-white/25 text-white/90' : 'bg-cinnabar-accent text-white'
                } ${opensLeft ? 'right-0 rounded-l-sm' : 'left-0 rounded-r-sm'}`}
              >
                {opensLeft ? `◀ ${m.label}` : `${m.label} ▶`}
              </span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
