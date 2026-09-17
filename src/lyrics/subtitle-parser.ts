// src/lyrics/subtitle-parser.ts
import type { TimedLine } from '../core/types'
import { parseLRC } from './lrc-parser'
import { linesFromPlainText } from '../sources/songBuilder'

// The hours field is OPTIONAL on both sides: WebVTT permits `MM:SS.mmm`, and
// short-clip subtitle files routinely omit the `00:` hour. Requiring it made
// every cue in such a file look like a header block and be dropped silently,
// so a valid import produced "No lyric lines found".
const CUE_TIME = /(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})/

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return +(h ?? 0) * 3600 + +m * 60 + +s + +ms / 1000
}

/**
 * Captions arrive as WebVTT (HTML-ish) text, where `&` is written `&amp;` and so
 * on. Tag-stripping alone leaves those entities literal, so "Rock & Roll" showed
 * up in the lyric sheet as "Rock &amp; Roll". `&amp;` is decoded LAST so an
 * escaped entity (`&amp;lt;`) becomes `&lt;` rather than being decoded twice.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

// Handles both SRT (comma milliseconds) and WebVTT (dot milliseconds).
function parseCueBased(text: string): TimedLine[] {
  const lines: TimedLine[] = []
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/)
  for (const block of blocks) {
    const rows = block.split('\n').map((r) => r.trim()).filter(Boolean)
    const timingIdx = rows.findIndex((r) => CUE_TIME.test(r))
    if (timingIdx === -1) continue // header/blank/index-only block
    const m = rows[timingIdx].match(CUE_TIME)!
    const startTime = toSeconds(m[1], m[2], m[3], m[4])
    const endTime = toSeconds(m[5], m[6], m[7], m[8])
    const original = decodeHtmlEntities(
      rows.slice(timingIdx + 1).join(' ').replace(/<[^>]+>/g, ''),
    ).trim()
    if (original) lines.push({ startTime, endTime, original, translation: '' })
  }
  return lines
}

export function parseSubtitle(text: string, filename: string): TimedLine[] {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'lrc') return parseLRC(text)
  if (ext === 'srt' || ext === 'vtt') return parseCueBased(text)
  return linesFromPlainText(text)
}
