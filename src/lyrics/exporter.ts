import type { TimedLine } from '../core/types'

function pad(n: number, len: number): string {
  return n.toString().padStart(len, '0')
}

function toMMSSCS(seconds: number): string {
  // Round to a whole centisecond FIRST so a fraction like 59.999 carries into
  // the next second instead of pushing a third digit into the fraction. The
  // app's own LRC parser reads the fraction by digit count (2 = hundredths,
  // 3 = milliseconds — see lrc-parser.ts), so the old "00:59.100" was both
  // out-of-shape and re-imported 0.899s early as 59.100.
  const totalCs = Math.round(seconds * 100)
  const m = Math.floor(totalCs / 6000)
  const s = Math.floor((totalCs % 6000) / 100)
  const cs = totalCs % 100
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`
}

function toHHMMSSMS(seconds: number): string {
  // Same carry as toMMSSCS: 1.9996 must become 00:00:02,000 rather than
  // ",1000" — SRT allows only 0–999 ms, and subtitle-parser.ts requires
  // exactly three digits, so a ",1000" cue is dropped outright elsewhere.
  const totalMs = Math.round(seconds * 1000)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  const s = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

/**
 * Whether a line carries real timing. Deliberately the same test the rest of
 * the app uses to answer "does this song have timing?" (SettingsView's
 * songHasTiming, EditMode.tsx, bilingual.ts, replaceLyricsLoss.ts): an untimed
 * line is exactly { startTime: 0, endTime: 0 } — what TapSyncEditor stores for
 * every line the user did not tap. A genuinely timed first line still counts,
 * because its endTime is > 0.
 */
export function lineHasTiming(line: TimedLine): boolean {
  return line.startTime > 0 || line.endTime > 0
}

export function exportLRC(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  // Untimed lines are OMITTED, never stamped at [00:00.00]. TapSyncEditor
  // legitimately saves "timing for N of M" lines, so a 3-of-20 tap-through
  // would otherwise produce 17 lines all claiming t=0: a file that looks valid,
  // loses the real order, and re-imports through our own parseLRC as genuine
  // timing. Nothing here fabricates a timestamp.
  const timed = lines.filter(lineHasTiming)
  // Belt-and-braces: the call sites already hide the action when no line has
  // timing, but an all-untimed list must never yield a fake file.
  if (timed.length === 0) return ''
  return timed.map((l) => `[${toMMSSCS(l.startTime)}]${l[field]}`).join('\n')
}

export function exportSRT(lines: TimedLine[], field: 'original' | 'translation' = 'original'): string {
  // Same rule as exportLRC: an untimed line would otherwise be written as a
  // 00:00:00,000 --> 00:00:00,000 cue, i.e. a zero-length cue claiming audio
  // that does not exist. Cue numbers stay contiguous because the filter runs
  // before the numbering.
  const timed = lines.filter(lineHasTiming)
  if (timed.length === 0) return ''
  return timed.map((l, i) =>
    `${i + 1}\n${toHHMMSSMS(l.startTime)} --> ${toHHMMSSMS(l.endTime)}\n${l[field]}\n`
  ).join('\n')
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
