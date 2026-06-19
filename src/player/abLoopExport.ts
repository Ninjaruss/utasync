import { downloadBlob } from '../lyrics/exporter'
import type { TimedLine } from '../core/types'
import { isValidABPair } from './abLoopUtils'

/** Remove characters that are invalid in cross-platform file names. */
export function sanitizeFilenamePart(text: string): string {
  return text.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

/** Compact timestamp for file names, e.g. 83.4 → "1m23s". */
export function formatAbLoopTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}

export function truncateLyricSnippet(text: string, maxLen = 36): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= maxLen) return cleaned
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`
}

/**
 * Base name shared by exported audio/subtitle files.
 * Example: "Yorushika - Itte — AB loop 8s–23s — 言の葉"
 */
export function abLoopExportBasename(
  artist: string,
  title: string,
  a: number,
  b: number,
  lyricHint?: string | null,
): string {
  const artistPart = sanitizeFilenamePart(artist || 'Unknown artist')
  const titlePart = sanitizeFilenamePart(title || 'Untitled')
  const aLabel = formatAbLoopTimestamp(a)
  const bLabel = formatAbLoopTimestamp(b)
  const lyricPart = lyricHint ? ` — ${sanitizeFilenamePart(truncateLyricSnippet(lyricHint))}` : ''
  return `${artistPart} - ${titlePart} — AB loop ${aLabel}–${bLabel}${lyricPart}`
}

export function lineIsTimed(line: TimedLine): boolean {
  return line.endTime > line.startTime || line.startTime > 0
}

/** Lyrics intersecting [a, b), shifted so the loop start is t=0. */
export function sliceLinesForAbExport(lines: TimedLine[], a: number, b: number): TimedLine[] {
  const duration = b - a
  return lines
    .filter((l) => lineIsTimed(l) && l.endTime > a && l.startTime < b)
    .map((l) => ({
      ...l,
      startTime: Math.max(0, l.startTime - a),
      endTime: Math.min(duration, l.endTime - a),
    }))
    .filter((l) => l.endTime > l.startTime)
}

/** Primary lyric line for naming — prefers the line at point A, else first line in range. */
export function lyricHintForAbLoop(lines: TimedLine[], a: number, b: number): string | null {
  const anchor = lines.find(
    (l) => lineIsTimed(l) && l.startTime <= a && l.endTime > a && l.original.trim(),
  )
  if (anchor) return anchor.original.trim()
  const sliced = sliceLinesForAbExport(lines, a, b)
  const first = sliced.find((l) => l.original.trim())
  return first?.original.trim() ?? null
}

export function abLoopHasTimedLyrics(lines: TimedLine[], a: number, b: number): boolean {
  return sliceLinesForAbExport(lines, a, b).length > 0
}

export function exportAbLoopSRT(lines: TimedLine[]): string {
  return lines
    .map((l, i) => {
      const text = l.translation.trim()
        ? `${l.original}\n${l.translation.trim()}`
        : l.original
      const start = formatSrtTime(l.startTime)
      const end = formatSrtTime(l.endTime)
      return `${i + 1}\n${start} --> ${end}\n${text}\n`
    })
    .join('\n')
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  const pad = (n: number, len: number) => n.toString().padStart(len, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function encodeWavSegment(audioBuffer: AudioBuffer, startSec: number, endSec: number): Uint8Array {
  const sampleRate = audioBuffer.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * sampleRate))
  const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * sampleRate))
  const numChannels = audioBuffer.numberOfChannels
  const length = Math.max(0, endSample - startSample)
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = length * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = audioBuffer.getChannelData(ch)[startSample + i] ?? 0
      const clamped = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Store-only ZIP (no compression) for broad browser support. */
export function createZipArchive(files: { name: string; data: Uint8Array }[]): Blob {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name)
    const crc = crc32(file.data)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, file.data.length, true)
    lv.setUint32(22, file.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    localParts.push(local, file.data)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, file.data.length, true)
    cv.setUint32(24, file.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + file.data.length
  }

  const centralSize = centralParts.reduce((n, p) => n + p.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...localParts, ...centralParts, end] as BlobPart[], { type: 'application/zip' })
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export async function exportAbLoopClip(options: {
  audioFile: File
  lines: TimedLine[]
  artist: string
  title: string
  a: number
  b: number
  includeSrt?: boolean
}): Promise<{ basename: string; includedSrt: boolean }> {
  const { audioFile, lines, artist, title, a, b, includeSrt = false } = options
  if (!isValidABPair(a, b)) throw new Error('Set both A and B points before exporting.')

  const lyricHint = lyricHintForAbLoop(lines, a, b)
  const basename = abLoopExportBasename(artist, title, a, b, lyricHint)
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await audioFile.arrayBuffer())
    const wavData = encodeWavSegment(decoded, a, b)
    const sliced = sliceLinesForAbExport(lines, a, b)
    const shouldIncludeSrt = includeSrt && sliced.length > 0

    if (shouldIncludeSrt) {
      const zipFiles: { name: string; data: Uint8Array }[] = [
        { name: `${basename}.wav`, data: wavData },
        { name: `${basename}.srt`, data: new TextEncoder().encode(exportAbLoopSRT(sliced)) },
      ]
      downloadBlob(createZipArchive(zipFiles), `${basename}.zip`)
      return { basename, includedSrt: true }
    }

    downloadBlob(new Blob([wavData as BlobPart], { type: 'audio/wav' }), `${basename}.wav`)
    return { basename, includedSrt: false }
  } finally {
    await ctx.close()
  }
}
