import type { TimedLine } from '../core/types'

const isTimed = (l: TimedLine) => l.endTime > 0 || l.startTime > 0
const hasTranslation = (l: TimedLine) => !!l.translation?.trim()

/**
 * What replacing the lyric sheet would destroy, phrased for a confirm dialog —
 * or null when the swap costs nothing and should just happen.
 *
 * Replacing overwrites `lines` wholesale, so hand-tapped timing and an attached
 * second language vanish with no undo. Incoming lyrics that carry their own
 * timing (an LRC) or their own translation replace rather than lose it, so those
 * cases stay quiet: a confirmation the user learns to dismiss is worse than none.
 */
export function describeReplaceLoss(current: TimedLine[], imported: TimedLine[]): string | null {
  const timedCount = current.filter(isTimed).length
  const losesTiming = timedCount > 0 && !imported.some(isTimed)
  const losesTranslation = current.some(hasTranslation) && !imported.some(hasTranslation)
  if (!losesTiming && !losesTranslation) return null

  const parts: string[] = []
  if (losesTiming) parts.push(`timing for ${timedCount} ${timedCount === 1 ? 'line' : 'lines'}`)
  if (losesTranslation) parts.push('your attached translation')
  return `This removes ${parts.join(' and ')}. It can't be undone.`
}
