/** Manual audio windowing for WebGPU Whisper. transformers.js's internal
 * long-form (>30s) chunk merge is broken on the WebGPU backend (a 60s clip
 * collapses to one garbage word), but SINGLE-window (<=30s) calls produce
 * correct word timestamps. So we window the audio ourselves, transcribe each
 * window as a single-chunk call, and stitch with offsets + overlap dedup —
 * reimplementing the stride-merge in a pure, testable module. */

export const WINDOW_S = 30
export const OVERLAP_S = 5
/** A trailing window shorter than this merges into the previous one by
 * shifting the last window's start back so it ends at the audio end. */
const MIN_TAIL_S = 8

export interface AudioWindow {
  startS: number
  endS: number
}

export function planWindows(totalSamples: number, sampleRate: number): AudioWindow[] {
  const totalS = totalSamples / sampleRate
  if (totalS <= 0) return []
  if (totalS <= WINDOW_S) return [{ startS: 0, endS: totalS }]
  const stride = WINDOW_S - OVERLAP_S
  const windows: AudioWindow[] = []
  for (let start = 0; start < totalS - OVERLAP_S; start += stride) {
    windows.push({ startS: start, endS: Math.min(start + WINDOW_S, totalS) })
  }
  const last = windows[windows.length - 1]
  if (windows.length > 1 && last.endS - last.startS < MIN_TAIL_S) {
    // The sliver is too short to stand alone. Replace it AND the window
    // before it with a single full-length window ending at the audio end
    // (the sliver's short span is already covered by this wider window).
    windows.pop()
    const prev = windows.pop()
    const newStart = prev ? Math.max(prev.startS + 1, totalS - WINDOW_S) : Math.max(0, totalS - WINDOW_S)
    windows.push({ startS: newStart, endS: totalS })
  }
  return windows
}

export interface StitchChunk {
  text: string
  timestamp: [number, number | null]
}

export interface WindowResult {
  offsetS: number
  /** Absolute end time of this window (for null-end clamping + dedup cuts). */
  windowEndS: number
  chunks: StitchChunk[]
}

/** Merge per-window results into one transcript. Overlapping words are deduped
 * at the overlap midpoint: a chunk belongs to the earlier window if its
 * midpoint is before the cut, to the later window otherwise. */
export function stitchChunkedResults(windows: WindowResult[]): { text: string; chunks: StitchChunk[] } {
  const kept: StitchChunk[] = []
  for (let w = 0; w < windows.length; w++) {
    const { offsetS, windowEndS, chunks } = windows[w]
    // Cut points against the previous/next windows (absolute times).
    const prevEnd = w > 0 ? windows[w - 1].windowEndS : -Infinity
    const cutBefore = w > 0 ? (offsetS + prevEnd) / 2 : -Infinity
    const nextStart = w + 1 < windows.length ? windows[w + 1].offsetS : Infinity
    const cutAfter = w + 1 < windows.length ? (nextStart + windowEndS) / 2 : Infinity

    for (let i = 0; i < chunks.length; i++) {
      const raw = chunks[i]
      const start = raw.timestamp[0]
      if (!Number.isFinite(start)) continue
      const absStart = offsetS + start
      const rawEnd = raw.timestamp[1]
      // A null end on the window's final chunk clamps to the window end.
      const absEnd = Number.isFinite(rawEnd as number) ? offsetS + (rawEnd as number) : windowEndS
      const mid = (absStart + absEnd) / 2
      if (mid < cutBefore || mid >= cutAfter) continue
      kept.push({ text: raw.text, timestamp: [absStart, absEnd] })
    }
  }
  kept.sort((a, b) => a.timestamp[0] - b.timestamp[0])
  return { text: kept.map((k) => k.text).join(''), chunks: kept }
}
