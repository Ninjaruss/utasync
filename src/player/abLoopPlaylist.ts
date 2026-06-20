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

export function playlistRepeatLabel(repeatCount: number): string {
  return isInfinitePlaylistRepeat(repeatCount) ? '∞' : String(repeatCount)
}

export function playlistRepeatHelpText(repeatCount: number): string {
  const repeats = normalizePlaylistRepeatCount(repeatCount)
  if (isInfinitePlaylistRepeat(repeats)) {
    return 'Each loop repeats until you stop the playlist or pick another entry.'
  }
  const times = repeats === 1 ? 'once' : `${repeats} times`
  return `Each loop repeats ${times}, then advances to the next entry.`
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
