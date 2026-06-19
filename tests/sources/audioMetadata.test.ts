import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deriveTitle,
  extractAudioMetadata,
  parseFilename,
  unpackCombinedTags,
  resolveTrackMetadata,
} from '../../src/sources/audioMetadata'

const parseBlob = vi.fn()
vi.mock('music-metadata', () => ({ parseBlob: (...args: unknown[]) => parseBlob(...args) }))

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
