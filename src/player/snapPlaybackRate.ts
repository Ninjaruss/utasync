/**
 * The nearest rate the player will actually honour.
 *
 * YouTube's embed accepts only a fixed set of playback rates and silently
 * ignores anything else — so the app's 60% "Slower" preset, and most slider
 * stops, left the UI claiming a speed the audio was not playing at. Snapping
 * keeps the control honest; the caller reports the returned value back so what
 * is displayed is what is playing.
 *
 * Ties go to the slower rate: this is a study tool, and the user asking for
 * "slower" would rather land under their request than over it.
 */
export function snapToSupportedRate(requested: number, available: number[] | undefined): number {
  if (!available || available.length === 0) return requested

  let best = available[0]
  let bestDistance = Math.abs(best - requested)
  for (const rate of available) {
    const distance = Math.abs(rate - requested)
    if (distance < bestDistance || (distance === bestDistance && rate < best)) {
      best = rate
      bestDistance = distance
    }
  }
  return best
}
