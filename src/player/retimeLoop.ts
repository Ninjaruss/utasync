/**
 * The short loop that plays while a line is being re-timed.
 *
 * Plain seek-on-drag was measured insufficient. Dragging while paused is silent
 * (`howl.seek()` does not start playback), and while playing the playhead runs
 * ~2.5s past the candidate within 1.5s of thinking time — so at the moment you
 * judge "was that right?", the onset you positioned has already gone by, and the
 * only way to hear it again is to move the slider again. That destroys the one
 * affordance a drag has over a tap: holding still and confirming.
 *
 * Looping the candidate fixes that by construction. Pure and DOM-free so the
 * window arithmetic and the wrap decision are testable without an audio engine.
 */

/**
 * Lead-in before the candidate. An entry is judged by hearing silence break, so
 * the loop has to start before the moment under test — starting on it would play
 * the vocal with nothing to compare it against.
 */
export const RETIME_LOOP_LEAD_SEC = 0.5
/** Tail after it: enough to recognise the phrase, not a whole bar. */
export const RETIME_LOOP_TAIL_SEC = 1.5

export interface RetimeLoop {
  startSec: number
  endSec: number
  /** The time under test — where the line start would land. */
  candidateSec: number
}

/** Loop window around a candidate, clamped to the track. */
export function retimeLoopFor(
  candidateSec: number,
  opts?: { durationSec?: number; leadSec?: number; tailSec?: number },
): RetimeLoop {
  const lead = opts?.leadSec ?? RETIME_LOOP_LEAD_SEC
  const tail = opts?.tailSec ?? RETIME_LOOP_TAIL_SEC
  const candidate = Number.isFinite(candidateSec) && candidateSec > 0 ? candidateSec : 0
  const startSec = Math.max(0, candidate - lead)
  const duration = opts?.durationSec
  const wanted = candidate + tail
  // Clamping the end at the track length can collapse the window for a candidate
  // right at the end, which would wrap on every tick and jam playback. Keep a
  // floor so the loop is always playable.
  const endSec = Number.isFinite(duration) && duration! > 0
    ? Math.max(startSec + 0.25, Math.min(duration!, wanted))
    : wanted
  return { startSec, endSec, candidateSec: candidate }
}

/**
 * Whether the playhead has run out of the loop and should be sent back.
 *
 * Only forward escapes count. A position BEHIND the window means the user seeked
 * away deliberately; treating that as a wrap would drag them back and fight the
 * navigation they just performed.
 */
export function needsWrap(loop: RetimeLoop | null, positionSec: number): boolean {
  if (!loop) return false
  return positionSec >= loop.endSec
}
