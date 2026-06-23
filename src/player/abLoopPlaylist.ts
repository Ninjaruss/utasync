import type { ABLoopPlaylistEntry } from '../core/types'

/** Default matches legacy abLoop.loopCount (3) before playlist had its own setting. */
export const DEFAULT_PLAYLIST_REPEAT_COUNT = 3

/** Preset repeat counts; 0 means repeat indefinitely (no auto-advance). */
export const PLAYLIST_REPEAT_PRESETS = [1, 3, 5, 0] as const

export function isInfinitePlaylistRepeat(repeatCount: number): boolean {
  return repeatCount <= 0
}

export function normalizePlaylistRepeatCount(repeatCount: number): number {
  if (!Number.isFinite(repeatCount)) return DEFAULT_PLAYLIST_REPEAT_COUNT
  return Math.max(0, Math.floor(repeatCount))
}

/** True when a completed A–B cycle should advance to the next playlist entry. */
export function shouldAdvancePlaylistAfterCycle(
  cyclesCompleted: number,
  repeatCount: number,
): boolean {
  const repeats = normalizePlaylistRepeatCount(repeatCount)
  if (isInfinitePlaylistRepeat(repeats)) return false
  return cyclesCompleted >= repeats
}

/** Next index when advancing through a playlist; wraps to 0 after the last entry. */
export function wrapPlaylistIndex(currentIndex: number, entryCount: number): number {
  if (entryCount <= 0) return 0
  return (currentIndex + 1) % entryCount
}

/** Previous index; wraps to the last entry from the first. */
export function wrapPlaylistIndexPrev(currentIndex: number, entryCount: number): number {
  if (entryCount <= 0) return 0
  return (currentIndex - 1 + entryCount) % entryCount
}

export function playlistRepeatButtonLabel(repeatCount: number): string {
  return isInfinitePlaylistRepeat(repeatCount) ? 'Repeats: ∞' : `Repeats: ${normalizePlaylistRepeatCount(repeatCount)}×`
}

export function playlistRepeatLabel(repeatCount: number): string {
  return isInfinitePlaylistRepeat(repeatCount) ? '∞' : String(repeatCount)
}

export function playlistRepeatHelpText(repeatCount: number): string {
  const repeats = normalizePlaylistRepeatCount(repeatCount)
  if (isInfinitePlaylistRepeat(repeats)) {
    return 'Repeats each loop until you stop or switch.'
  }
  const times = repeats === 1 ? 'once' : `${repeats}×`
  return `${times} per loop, then next · wraps until Stop`
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function createPlaylistEntry(
  a: number,
  b: number,
  label?: string,
): ABLoopPlaylistEntry {
  return {
    id: crypto.randomUUID(),
    a,
    b,
    label,
  }
}

export function playlistEntryLabel(entry: ABLoopPlaylistEntry): string {
  if (entry.label) return entry.label
  return `${formatTime(entry.a)}–${formatTime(entry.b)}`
}

export function movePlaylistEntryByIndex(
  entries: ABLoopPlaylistEntry[],
  from: number,
  to: number,
): ABLoopPlaylistEntry[] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return entries
  }
  const next = [...entries]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Scroll a child element into view inside a scroll container without moving outer panels. */
export function scrollElementInContainer(
  container: HTMLElement,
  element: HTMLElement,
  options?: { behavior?: ScrollBehavior; align?: 'start' | 'center' | 'nearest' },
): void {
  const behavior = options?.behavior ?? 'smooth'
  const align = options?.align ?? 'nearest'

  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const elementTop = elementRect.top - containerRect.top + container.scrollTop
  const elementHeight = elementRect.height
  const containerHeight = container.clientHeight

  let target: number
  if (align === 'center') {
    target = elementTop - (containerHeight - elementHeight) / 2
  } else if (align === 'start') {
    target = elementTop
  } else {
    const viewTop = container.scrollTop
    const viewBottom = viewTop + containerHeight
    const elementBottom = elementTop + elementHeight
    if (elementTop >= viewTop && elementBottom <= viewBottom) return
    target = elementTop < viewTop ? elementTop : elementBottom - containerHeight
  }

  container.scrollTo({ top: Math.max(0, target), behavior })
}
