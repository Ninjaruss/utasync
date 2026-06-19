import { describe, it, expect } from 'vitest'
import { pickCaptionTrack, parseYouTubeTranscriptXml } from '../../src/sources/youtubeCaptions'

describe('pickCaptionTrack', () => {
  const tracks = [
    { langCode: 'en', name: 'English (auto-generated)', kind: 'asr', baseUrl: 'https://example.com/en' },
    { langCode: 'ja', name: 'Japanese', baseUrl: 'https://example.com/ja' },
  ]

  it('prefers manual captions over auto-generated', () => {
    expect(pickCaptionTrack(tracks, ['en', 'ja'])?.langCode).toBe('ja')
  })

  it('falls back to auto-generated when no manual track matches language', () => {
    const asrOnly = [tracks[0]]
    expect(pickCaptionTrack(asrOnly, ['en'])?.kind).toBe('asr')
  })
})

describe('parseYouTubeTranscriptXml', () => {
  it('parses timed text nodes', () => {
    const xml = `<?xml version="1.0"?>
<transcript>
  <text start="1.2" dur="2.5">Hello world</text>
  <text start="4" dur="1">Second line</text>
</transcript>`
    const lines = parseYouTubeTranscriptXml(xml)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ startTime: 1.2, endTime: 3.7, original: 'Hello world' })
    expect(lines[1].original).toBe('Second line')
  })
})
