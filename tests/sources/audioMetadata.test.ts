import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deriveTitle, extractAudioMetadata, parseFilename } from '../../src/sources/audioMetadata'

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
    expect(parseFilename('Radwimps - Sparkle.mp3')).toEqual({ artist: 'Radwimps', title: 'Sparkle' })
  })
  it('handles en-dash and em-dash separators', () => {
    expect(parseFilename('A – B.flac')).toEqual({ artist: 'A', title: 'B' })
    expect(parseFilename('A — B.flac')).toEqual({ artist: 'A', title: 'B' })
  })
  it('splits on the first separator only, keeping later dashes in the title', () => {
    expect(parseFilename('Artist - Title - Remix.wav')).toEqual({ artist: 'Artist', title: 'Title - Remix' })
  })
  it('returns title-only when there is no separator', () => {
    expect(parseFilename('Just A Title.mp3')).toEqual({ title: 'Just A Title' })
  })
})
