import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  abLoopExportBasename,
  abLoopPlaylistExportBasename,
  sliceLinesForAbExport,
  exportAbLoopSRT,
  encodeWavSegment,
  createZipArchive,
  sanitizeFilenamePart,
  lyricHintForAbLoop,
  truncateLyricSnippet,
  getValidPlaylistExportSegments,
  combineSrtLinesForPlaylistExport,
  concatenateAbLoopSegments,
  clampSegmentsToAudio,
  exportAbLoopClip,
  exportAbLoopPlaylistClip,
} from '../../src/player/abLoopExport'
import type { ABLoopPlaylistEntry, TimedLine } from '../../src/core/types'

// The real downloadBlob needs URL.createObjectURL and an anchor click, neither of
// which jsdom implements; capturing the Blob lets a test read the bytes we built.
const downloads = vi.hoisted(() => ({ blobs: [] as Blob[] }))
vi.mock('../../src/lyrics/exporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lyrics/exporter')>()
  return {
    ...actual,
    downloadBlob: (blob: Blob) => { downloads.blobs.push(blob) },
  }
})

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

  it('matches the tapped line when A uses playback-start lead time', () => {
    const leadLines: TimedLine[] = [
      { startTime: 0, endTime: 1, original: 'before', translation: '' },
      { startTime: 1, endTime: 3, original: 'hello', translation: '' },
    ]
    expect(lyricHintForAbLoop(leadLines, 0.82, 3)).toBe('hello')
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

  // SRT timecodes only allow 0–999 ms. A fraction like 1.9996 used to round to
  // ",1000" instead of carrying into the next second, which parsers reject.
  it('carries sub-second rounding into the next second instead of emitting ,1000', () => {
    const line: TimedLine = { startTime: 0, endTime: 1.9996, original: 'x', translation: '' }
    const srt = exportAbLoopSRT([line])
    expect(srt).toContain('00:00:02,000')
    expect(srt).not.toContain(',1000')
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

  // Names are written as UTF-8, but without general-purpose bit 11 a spec-following
  // reader (Python zipfile, Info-ZIP unzip) decodes those bytes as CP437 — and every
  // exported name contains an em dash, so they all came out as mojibake.
  it('flags the entry name as UTF-8 in both the local and central headers', async () => {
    const name = 'Yorushika - Itte — AB loop 8s–23s — 言の葉.txt'
    const data = new TextEncoder().encode('hello')
    const zip = createZipArchive([{ name, data }])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const view = new DataView(bytes.buffer)
    const nameLength = new TextEncoder().encode(name).length
    const UTF8_FLAG = 0x0800

    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true) & UTF8_FLAG).toBe(UTF8_FLAG)

    const centralOffset = 30 + nameLength + data.length
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50)
    expect(view.getUint16(centralOffset + 8, true) & UTF8_FLAG).toBe(UTF8_FLAG)

    // And the flag is honest: the stored bytes really are UTF-8.
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLength))).toBe(name)
  })
})

describe('getValidPlaylistExportSegments', () => {
  it('keeps valid entries in order and drops invalid pairs', () => {
    const entries: ABLoopPlaylistEntry[] = [
      { id: '1', a: 10, b: 20 },
      { id: '2', a: 30, b: 25 },
      { id: '3', a: 40, b: 50 },
    ]
    expect(getValidPlaylistExportSegments(entries).map((e) => e.id)).toEqual(['1', '3'])
  })
})

describe('abLoopPlaylistExportBasename', () => {
  it('includes artist, title, and loop count', () => {
    expect(abLoopPlaylistExportBasename('Yorushika', 'Itte', 3)).toBe(
      'Yorushika - Itte — AB loop playlist (3 loops)',
    )
  })
})

describe('combineSrtLinesForPlaylistExport', () => {
  it('offsets lyrics across concatenated segments', () => {
    const segments = [
      { a: 12, b: 20 },
      { a: 25, b: 28 },
    ]
    const combined = combineSrtLinesForPlaylistExport(lines, segments)
    expect(combined.map((l) => l.original)).toEqual(['Inside loop', 'Also inside', 'After loop'])
    expect(combined[0].startTime).toBe(0)
    expect(combined[1].startTime).toBe(2)
    expect(combined[2].startTime).toBe(8)
    expect(combined[2].endTime).toBe(11)
  })
})

describe('concatenateAbLoopSegments', () => {
  it('concatenates multiple slices into one wav payload', () => {
    const sampleRate = 100
    const length = sampleRate * 3
    const channel = new Float32Array(length)
    channel.fill(0.5)
    const buffer = {
      sampleRate,
      length,
      numberOfChannels: 1,
      getChannelData: () => channel,
    } as AudioBuffer

    const wav = concatenateAbLoopSegments(buffer, [
      { a: 0.5, b: 1.0 },
      { a: 2.0, b: 2.5 },
    ])
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(wav.length).toBe(44 + (50 + 50) * 2)
  })

  it('throws when no segments are provided', () => {
    const buffer = {
      sampleRate: 44100,
      length: 44100,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(44100),
    } as AudioBuffer
    expect(() => concatenateAbLoopSegments(buffer, [])).toThrow(/No valid loop segments/)
  })
})

// ---------------------------------------------------------------------------
// B past the end of the decoded audio.
//
// B comes from a lyric line's endTime with no duration clamp, TapSyncEditor gives
// an untimed last line startTime + 5, and saved playlist entries survive an audio
// swap — so b > decodedDuration is reachable. The audio encoder has always stopped
// at the end of the buffer; the subtitle side advanced by the REQUESTED length, so
// every later cue was late by the truncation and the clip's .wav and .srt described
// two different timelines.
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 100
const DECODED_SECONDS = 13

/** Mono audio that is exactly 13s long, at a sample rate that keeps sample maths whole. */
function decodedBuffer(): AudioBuffer {
  const length = SAMPLE_RATE * DECODED_SECONDS
  const channel = new Float32Array(length)
  channel.fill(0.5)
  return {
    sampleRate: SAMPLE_RATE,
    length,
    numberOfChannels: 1,
    getChannelData: () => channel,
  } as AudioBuffer
}

class MockAudioContext {
  async decodeAudioData() {
    return decodedBuffer()
  }
  async close() {}
}

/** Store-only archive: walk the local headers and hand back name + stored bytes. */
function unzipStoredEntries(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries: { name: string; data: Uint8Array }[] = []
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(18, true)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength))
    const dataStart = offset + 30 + nameLength + extraLength
    entries.push({ name, data: bytes.slice(dataStart, dataStart + size) })
    offset = dataStart + size
  }
  return entries
}

function unzippedFrom(blob: Blob) {
  return blob.arrayBuffer().then((buf) => unzipStoredEntries(new Uint8Array(buf)))
}

/** Duration of a mono 16-bit RIFF/WAVE payload, in seconds. */
function wavSeconds(bytes: Uint8Array): number {
  return (bytes.length - 44) / 2 / SAMPLE_RATE
}

/** End time of every SRT cue, in seconds. */
function srtCueEnds(srt: string): number[] {
  return [...srt.matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)].map(
    (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000,
  )
}

describe('clampSegmentsToAudio', () => {
  it('clamps B to the decoded audio and drops segments with nothing left in them', () => {
    expect(
      clampSegmentsToAudio([{ a: 0, b: 10 }, { a: 10, b: 15 }, { a: 14, b: 20 }], DECODED_SECONDS),
    ).toEqual([{ a: 0, b: 10 }, { a: 10, b: 13 }])
  })
})

describe('exports whose B lies past the end of the audio', () => {
  beforeEach(() => {
    downloads.blobs.length = 0
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a playlist .srt on the same timeline as the truncated .wav', async () => {
    const result = await exportAbLoopPlaylistClip({
      audioFile: new File([new ArrayBuffer(16)], 'song.mp3', { type: 'audio/mpeg' }),
      lines,
      artist: 'Yorushika',
      title: 'Itte',
      // The second loop asks for 5s starting at 10s; only 3s of audio exist.
      entries: [{ id: '1', a: 0, b: 10 }, { id: '2', a: 10, b: 15 }],
      includeSrt: true,
    })
    expect(result.includedSrt).toBe(true)

    const entries = await unzippedFrom(downloads.blobs[0])
    const wav = entries.find((e) => e.name.endsWith('.wav'))!
    const srt = new TextDecoder().decode(entries.find((e) => e.name.endsWith('.srt'))!.data)

    const audio = wavSeconds(wav.data)
    expect(audio).toBe(DECODED_SECONDS)
    // The last cue must not claim audio the file does not contain.
    expect(Math.max(...srtCueEnds(srt))).toBe(audio)
    expect(srt).not.toContain('00:00:15,000')
    expect(srt).not.toContain('00:00:14,000')
  })

  it('keeps a single-clip .srt on the same timeline as the truncated .wav', async () => {
    const result = await exportAbLoopClip({
      audioFile: new File([new ArrayBuffer(16)], 'song.mp3', { type: 'audio/mpeg' }),
      lines,
      artist: 'Yorushika',
      title: 'Itte',
      a: 10,
      b: 15, // only 3s of audio exist after A
      includeSrt: true,
    })
    expect(result.includedSrt).toBe(true)

    const entries = await unzippedFrom(downloads.blobs[0])
    const wav = entries.find((e) => e.name.endsWith('.wav'))!
    const srt = new TextDecoder().decode(entries.find((e) => e.name.endsWith('.srt'))!.data)

    const audio = wavSeconds(wav.data)
    expect(audio).toBe(3)
    expect(Math.max(...srtCueEnds(srt))).toBe(audio)
  })

  it('throws instead of writing a silent clip when every saved loop is past the end', async () => {
    await expect(
      exportAbLoopPlaylistClip({
        audioFile: new File([new ArrayBuffer(16)], 'song.mp3', { type: 'audio/mpeg' }),
        lines,
        artist: 'Yorushika',
        title: 'Itte',
        entries: [{ id: '1', a: 20, b: 25 }],
        includeSrt: true,
      }),
    ).rejects.toThrow(/past the end/i)
    expect(downloads.blobs).toHaveLength(0)
  })
})
