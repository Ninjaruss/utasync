import type { ABLoopPlaylistEntry } from '../core/types'

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
