import type { TimedLine } from '../core/types'

const TIMESTAMP_RE = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/
const METADATA_RE = /^\[(?:ti|ar|al|by|re|ve):/i
const OFFSET_RE = /^\[offset:\s*([+-]?\d+)\]/i

function parseTimestamp(line: string): { time: number; text: string } | null {
  const match = line.match(TIMESTAMP_RE)
  if (!match) return null
  const minutes = parseInt(match[1])
  const seconds = parseInt(match[2])
  const centiseconds = match[3].length === 3
    ? parseInt(match[3]) / 1000
    : parseInt(match[3]) / 100
  const time = minutes * 60 + seconds + centiseconds
  const text = line.slice(match[0].length).trim()
  return { time, text }
}

export function parseLRC(lrc: string): TimedLine[] {
  const lines: Array<{ startTime: number; text: string }> = []
  let offsetSec = 0

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const offsetMatch = trimmed.match(OFFSET_RE)
    if (offsetMatch) {
      offsetSec = parseInt(offsetMatch[1], 10) / 1000
      continue
    }
    if (METADATA_RE.test(trimmed)) continue
    const parsed = parseTimestamp(trimmed)
    if (parsed) lines.push({ startTime: Math.max(0, parsed.time + offsetSec), text: parsed.text })
  }

  lines.sort((a, b) => a.startTime - b.startTime)

  return lines.map((line, i): TimedLine => ({
    startTime: line.startTime,
    endTime: lines[i + 1]?.startTime ?? line.startTime + 5,
    original: line.text,
    translation: '',
  }))
}

export function parseLRCPair(originalLRC: string, translationLRC: string): TimedLine[] {
  const origLines = parseLRC(originalLRC)
  const transLines = parseLRC(translationLRC)

  return origLines.map((line, i): TimedLine => ({
    ...line,
    translation: transLines[i]?.original ?? '',
  }))
}
