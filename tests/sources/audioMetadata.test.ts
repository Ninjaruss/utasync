import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deriveTitle,
  extractAudioMetadata,
  isPlausibleAudioFile,
  hasPlayableAudioHeader,
  isPlayableAudioFile,
  parseFilename,
  unpackCombinedTags,
  resolveTrackMetadata,
} from '../../src/sources/audioMetadata'

const parseBlob = vi.fn()
vi.mock('music-metadata', () => ({ parseBlob: (...args: unknown[]) => parseBlob(...args) }))

describe('isPlausibleAudioFile', () => {
  const make = (name: string, type = '') => new File(['x'], name, { type })

  it('accepts an audio/* MIME type regardless of extension', () => {
    expect(isPlausibleAudioFile(make('clip', 'audio/mpeg'))).toBe(true)
    expect(isPlausibleAudioFile(make('clip.bin', 'audio/x-wav'))).toBe(true)
  })

  it('accepts a known audio extension when the type is missing or generic', () => {
    expect(isPlausibleAudioFile(make('song.mp3'))).toBe(true)
    expect(isPlausibleAudioFile(make('song.FLAC', 'application/octet-stream'))).toBe(true)
    expect(isPlausibleAudioFile(make('song.opus'))).toBe(true)
  })

  it('rejects non-audio types and unknown/absent extensions', () => {
    expect(isPlausibleAudioFile(make('notes.txt', 'text/plain'))).toBe(false)
    expect(isPlausibleAudioFile(make('doc.pdf', 'application/pdf'))).toBe(false)
    expect(isPlausibleAudioFile(make('noextension'))).toBe(false)
  })
})

/**
 * `isPlausibleAudioFile` cannot see inside the file, and a browser types a file
 * by its extension — so it accepts anything named `.mp3`. This is the check that
 * actually reads the container, so a non-audio file cannot be stored as a song
 * that will never play or align.
 */
describe('hasPlayableAudioHeader', () => {
  const withBytes = (name: string, bytes: number[], type = 'audio/mpeg') =>
    new File([new Uint8Array(bytes)], name, { type })

  const ascii = (s: string) => s.split('').map((c) => c.charCodeAt(0))

  it('accepts the container signatures of every supported format', async () => {
    expect(await hasPlayableAudioHeader(withBytes('id3.mp3', [...ascii('ID3'), 0]))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('frame.mp3', [0xff, 0xfb, 0x90, 0x00]))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('a.wav', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('a.ogg', ascii('OggS')))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('a.flac', ascii('fLaC')))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('a.m4a', [0, 0, 0, 0, ...ascii('ftyp')]))).toBe(true)
    expect(await hasPlayableAudioHeader(withBytes('a.webm', [0x1a, 0x45, 0xdf, 0xa3]))).toBe(true)
  })

  it('rejects a file that merely claims to be audio', async () => {
    // A browser gives a renamed text file `audio/mpeg` from the .mp3 extension.
    expect(await hasPlayableAudioHeader(withBytes('fake.mp3', ascii('this is not audio')))).toBe(false)
  })

  it('rejects a file too short to carry a signature', async () => {
    expect(await hasPlayableAudioHeader(withBytes('tiny.mp3', [0xff]))).toBe(false)
  })
})

describe('isPlayableAudioFile', () => {
  it('accepts a real container under an advertised extension', async () => {
    expect(await isPlayableAudioFile(new File([new Uint8Array([0xff, 0xfb, 0, 0])], 'song.mp3', { type: 'audio/mpeg' }))).toBe(true)
  })

  it('rejects garbage renamed to .mp3', async () => {
    expect(await isPlayableAudioFile(new File(['not audio at all'], 'song.mp3', { type: 'audio/mpeg' }))).toBe(false)
  })

  // A file the browser types `audio/*` under an extension we do not advertise
  // keeps the old MIME-only behaviour rather than failing a signature check it
  // was never part of.
  it('leaves an unadvertised extension to the MIME check', async () => {
    expect(await isPlayableAudioFile(new File(['x'], 'song.aiff', { type: 'audio/aiff' }))).toBe(true)
  })

  it('still rejects a file the cheap check turns away', async () => {
    expect(await isPlayableAudioFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe(false)
  })
})

describe('deriveTitle', () => {
  it('strips a file extension', () => {
    expect(deriveTitle('My Song.mp3')).toBe('My Song')
  })
  it('keeps dotted names, dropping only the final extension', () => {
    expect(deriveTitle('a.b.flac')).toBe('a.b')
  })
  it('returns the name unchanged when there is no extension', () => {
    expect(deriveTitle('no extension')).toBe('no extension')
  })
})

describe('extractAudioMetadata', () => {
  beforeEach(() => parseBlob.mockReset())

  it('returns trimmed title and artist from common tags', async () => {
    parseBlob.mockResolvedValue({ common: { title: '  Tagged Title ', artist: 'Tagged Artist' } })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({ title: 'Tagged Title', artist: 'Tagged Artist' })
  })

  it('omits fields that are absent', async () => {
    parseBlob.mockResolvedValue({ common: { title: 'Only Title' } })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({ title: 'Only Title' })
  })

  it('includes the decoded track duration in seconds when available', async () => {
    parseBlob.mockResolvedValue({ common: { title: 'Tagged Title' }, format: { duration: 184.32 } })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({ title: 'Tagged Title', durationSec: 184.32 })
  })

  it('returns an empty object when parsing yields no usable data', async () => {
    parseBlob.mockResolvedValue({}) // malformed result: no `common`
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({})
  })
})

describe('parseFilename', () => {
  it('splits "Artist - Title.ext"', () => {
    expect(parseFilename('Radwimps - Sparkle.mp3')).toMatchObject({ artist: 'Radwimps', title: 'Sparkle' })
  })
  it('handles en-dash and em-dash separators', () => {
    expect(parseFilename('A – B.flac')).toMatchObject({ artist: 'A', title: 'B' })
    expect(parseFilename('A — B.flac')).toMatchObject({ artist: 'A', title: 'B' })
  })
  it('splits on the first separator only, keeping later dashes in the title', () => {
    expect(parseFilename('Artist - Title - Remix.wav')).toEqual({
      artist: 'Artist',
      title: 'Title - Remix',
      ambiguous: false,
    })
  })
  it('returns title-only when there is no separator', () => {
    expect(parseFilename('Just A Title.mp3')).toEqual({ title: 'Just A Title' })
  })

  it('detects Title - Artist order when the title side has feat.', () => {
    expect(parseFilename('Song Name feat. Guest - Artist Name.mp3')).toMatchObject({
      title: 'Song Name feat. Guest',
      artist: 'Artist Name',
    })
  })

  it('flags ambiguous filenames when both sides look equally plausible', () => {
    expect(parseFilename('Alpha - Beta.mp3').ambiguous).toBe(true)
  })
})

describe('unpackCombinedTags', () => {
  it('splits a combined title tag into artist and title', () => {
    expect(unpackCombinedTags({ title: 'Yorushika - Itte' })).toEqual({
      artist: 'Yorushika',
      title: 'Itte',
    })
  })

  it('splits a combined artist tag when title is missing', () => {
    expect(unpackCombinedTags({ artist: 'Radwimps - Sparkle' })).toEqual({
      artist: 'Radwimps',
      title: 'Sparkle',
    })
  })
})

describe('resolveTrackMetadata', () => {
  it('prefers tags over filename and labels each field source', () => {
    expect(resolveTrackMetadata({ title: 'Tagged', artist: 'Band' }, 'Other - File.mp3')).toEqual({
      title: 'Tagged',
      artist: 'Band',
      titleSource: 'tag',
      artistSource: 'tag',
      filenameAmbiguous: false,
    })
  })

  it('fills missing artist from filename', () => {
    expect(resolveTrackMetadata({ title: 'Itte' }, 'Yorushika - Itte.mp3')).toEqual({
      title: 'Itte',
      artist: 'Yorushika',
      titleSource: 'tag',
      artistSource: 'filename',
      filenameAmbiguous: false,
    })
  })
})
