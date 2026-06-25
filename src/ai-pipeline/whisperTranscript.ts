import type { TranscriptChunk, WhisperTranscript } from './whisperTranscriber'

/** Strip heavy / non-JSON fields from a raw transformers Whisper result before postMessage. */
export function slimWhisperTranscript(raw: unknown): WhisperTranscript {
  const r = raw as { text?: unknown; chunks?: unknown }
  const text = typeof r.text === 'string' ? r.text : ''
  const chunks: TranscriptChunk[] = []

  if (Array.isArray(r.chunks)) {
    for (const entry of r.chunks) {
      const c = entry as { text?: unknown; timestamp?: unknown }
      const word = typeof c.text === 'string' ? c.text.trim() : ''
      if (!word) continue
      const ts = c.timestamp
      if (!Array.isArray(ts) || ts.length < 2) continue
      const start = Number(ts[0])
      const end = Number(ts[1])
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      chunks.push({ text: word, timestamp: [start, end] })
    }
  }

  return { text, chunks }
}
