import { durationMatches } from './lyricsMatch'

/** Minimum shape needed to judge a candidate — anything with an id and a length. */
export interface RerankCandidate {
  id: number
  duration?: number
}

/**
 * A better-matching candidate for a now-known track length, or null to stay quiet.
 *
 * YouTube songs resolve their lyrics before any duration is available, so the
 * first match is chosen on title and artist alone. Once playback reports a real
 * length we can re-judge — but it is only worth interrupting the user when BOTH:
 *
 *   1. the candidate in use is outside tolerance, and
 *   2. another candidate is inside it.
 *
 * Re-ranking on a marginal score difference would nag about matches that are
 * already correct, which is how a useful prompt turns into one people dismiss.
 *
 * Pure: no network, no re-search. Callers supply the list they already have.
 */
export function findCloserCandidate<T extends RerankCandidate>(
  current: T,
  candidates: readonly T[],
  knownDurationSec: number | undefined,
): T | null {
  // `> 0`, not merely finite: a zero length is what an unreadable file or an
  // unstarted player reports, and treating it as known would "match" it against
  // an equally bogus zero-length candidate and recommend swapping to it.
  if (knownDurationSec == null || !Number.isFinite(knownDurationSec) || knownDurationSec <= 0) {
    return null
  }
  // No stored length means no evidence the current pick is wrong.
  if (current.duration == null) return null
  if (durationMatches(current.duration, knownDurationSec)) return null

  const better = candidates
    .filter((c) => c.id !== current.id && c.duration != null)
    .filter((c) => durationMatches(c.duration, knownDurationSec))
    .sort(
      (a, b) =>
        Math.abs((a.duration as number) - knownDurationSec)
        - Math.abs((b.duration as number) - knownDurationSec),
    )

  return better[0] ?? null
}
