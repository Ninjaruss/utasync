import type { TimedLine } from '../core/types'

function pad(n: number, len: number): string {
  return n.toString().padStart(len, '0')
}

function toMMSSCS(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.round((seconds % 1) * 100)
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`
}

function toHHMMSSMS(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function exportLRC(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  return lines
    .map((l) => `[${toMMSSCS(l.startTime)}]${l[field]}`)
    .join('\n')
}

export function exportSRT(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  return lines.map((l, i) =>
    `${i + 1}\n${toHHMMSSMS(l.startTime)} --> ${toHHMMSSMS(l.endTime)}\n${l[field]}\n`
  ).join('\n')
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
