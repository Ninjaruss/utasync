import { describe, it, expect } from 'vitest'
import {
  abLoopExportBasename,
  sliceLinesForAbExport,
  exportAbLoopSRT,
  encodeWavSegment,
  createZipArchive,
  sanitizeFilenamePart,
  lyricHintForAbLoop,
  truncateLyricSnippet,
} from '../../src/player/abLoopExport'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 5, endTime: 8, original: 'Before loop', translation: '' },
  { startTime: 10, endTime: 13, original: 'Inside loop', translation: 'In the loop' },
  { startTime: 14, endTime: 17, original: 'Also inside', translation: '' },
  { startTime: 25, endTime: 28, original: 'After loop', translation: '' },
]

describe('abLoopExportBasename', () => {
  it('includes artist, title, and both loop endpoints', () => {
    expect(abLoopExportBasename('Yorushika', 'Itte', 8, 23)).toBe(
      'Yorushika - Itte — AB loop 8s–23s',
    )
  })

  it('sanitizes invalid filename characters', () => {
    expect(abLoopExportBasename('A/B', 'Title: Live', 65, 90)).toBe(
      'A-B - Title- Live — AB loop 1m05s–1m30s',
    )
  })

  it('appends a lyric snippet when provided', () => {
    expect(abLoopExportBasename('Yorushika', 'Itte', 8, 23, 'Inside loop')).toBe(
      'Yorushika - Itte — AB loop 8s–23s — Inside loop',
    )
  })
})

describe('truncateLyricSnippet', () => {
  it('truncates long lyric text for filenames', () => {
    const long = 'あ'.repeat(40)
    expect(truncateLyricSnippet(long, 10)).toBe(`${'あ'.repeat(9)}…`)
  })
})

describe('lyricHintForAbLoop', () => {
  it('prefers the lyric line at point A', () => {
    expect(lyricHintForAbLoop(lines, 10.5, 20)).toBe('Inside loop')
  })
})

describe('sanitizeFilenamePart', () => {
  it('replaces path-like characters', () => {
    expect(sanitizeFilenamePart('foo/bar:baz')).toBe('foo-bar-baz')
  })
})

describe('sliceLinesForAbExport', () => {
  it('keeps intersecting lines and shifts timestamps to loop start', () => {
    const sliced = sliceLinesForAbExport(lines, 12, 20)
    expect(sliced.map((l) => l.original)).toEqual(['Inside loop', 'Also inside'])
    expect(sliced[0].startTime).toBe(0)
    expect(sliced[0].endTime).toBe(1)
    expect(sliced[1].startTime).toBe(2)
    expect(sliced[1].endTime).toBe(5)
  })
})

describe('exportAbLoopSRT', () => {
  it('includes translation on a second line when present', () => {
    const srt = exportAbLoopSRT(sliceLinesForAbExport(lines, 12, 20))
    expect(srt).toContain('Inside loop\nIn the loop')
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000')
  })
})

describe('encodeWavSegment', () => {
  it('writes a valid RIFF/WAVE header for a mono slice', () => {
    const sampleRate = 44100
    const length = sampleRate * 2
    const channel = new Float32Array(length)
    const buffer = {
      sampleRate,
      length,
      numberOfChannels: 1,
      getChannelData: () => channel,
    } as AudioBuffer
    const wav = encodeWavSegment(buffer, 0.5, 1.5)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(sampleRate)
    expect(wav.length).toBe(44 + sampleRate * 2)
  })
})

describe('createZipArchive', () => {
  it('produces a zip with local and central headers', () => {
    const zip = createZipArchive([
      { name: 'test.txt', data: new TextEncoder().encode('hello') },
    ])
    expect(zip.type).toBe('application/zip')
    return zip.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf)
      expect(bytes[0]).toBe(0x50)
      expect(bytes[1]).toBe(0x4b)
    })
  })
})
