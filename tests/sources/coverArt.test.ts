import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractEmbeddedCoverArt,
  fetchItunesCoverArt,
  itunesArtworkUrl,
  resolveCoverArt,
} from '../../src/sources/coverArt'

const parseBlob = vi.fn()
vi.mock('music-metadata', () => ({ parseBlob: (...args: unknown[]) => parseBlob(...args) }))

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

describe('itunesArtworkUrl', () => {
  it('upgrades artwork to a larger size', () => {
    expect(itunesArtworkUrl('https://is1-ssl.mzstatic.com/x/100x100bb.jpg', 600))
      .toBe('https://is1-ssl.mzstatic.com/x/600x600bb.jpg')
  })
})

describe('extractEmbeddedCoverArt', () => {
  beforeEach(() => {
    parseBlob.mockReset()
    vi.resetModules()
  })

  it('returns a data URL when the file has embedded art', async () => {
    parseBlob.mockResolvedValue({
      common: {
        picture: [{ format: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff]) }],
      },
    })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    const url = await extractEmbeddedCoverArt(file)
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('returns null when there is no picture', async () => {
    parseBlob.mockResolvedValue({ common: {} })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractEmbeddedCoverArt(file)).toBeNull()
  })

  it('returns null when parsing fails', async () => {
    parseBlob.mockImplementation(() => Promise.reject(new Error('bad file')))
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    await expect(extractEmbeddedCoverArt(file)).resolves.toBeNull()
  })
})

describe('fetchItunesCoverArt', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns the best-scoring artwork URL', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        results: [
          {
            trackName: 'Sparkle',
            artistName: 'Radwimps',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/x/100x100bb.jpg',
          },
          {
            trackName: 'Unrelated',
            artistName: 'Other Band',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/y/100x100bb.jpg',
          },
        ],
      }),
    })
    const url = await fetchItunesCoverArt('Sparkle', 'Radwimps')
    expect(url).toBe('https://is1-ssl.mzstatic.com/x/600x600bb.jpg')
  })

  it('returns null when no results match well enough', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        results: [{ trackName: 'Totally Different', artistName: 'Nobody', artworkUrl100: 'https://x/100x100bb.jpg' }],
      }),
    })
    expect(await fetchItunesCoverArt('Sparkle', 'Radwimps')).toBeNull()
  })
})

describe('resolveCoverArt', () => {
  beforeEach(() => {
    parseBlob.mockReset()
    vi.resetAllMocks()
  })

  it('prefers embedded art over YouTube thumbnail and iTunes', async () => {
    parseBlob.mockResolvedValue({
      common: {
        picture: [{ format: 'image/png', data: new Uint8Array([1, 2, 3]) }],
      },
    })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    const url = await resolveCoverArt({
      title: 'Sparkle',
      artist: 'Radwimps',
      audioFile: file,
      youtubeThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
    })
    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to YouTube thumbnail before iTunes', async () => {
    parseBlob.mockResolvedValue({ common: {} })
    const url = await resolveCoverArt({
      title: 'Sparkle',
      artist: 'Radwimps',
      youtubeThumbnailUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
    })
    expect(url).toBe('https://img.youtube.com/vi/abc/hqdefault.jpg')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('looks up iTunes when no local or YouTube art is available', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        results: [{
          trackName: 'Sparkle',
          artistName: 'Radwimps',
          artworkUrl100: 'https://is1-ssl.mzstatic.com/x/100x100bb.jpg',
        }],
      }),
    })
    const url = await resolveCoverArt({ title: 'Sparkle', artist: 'Radwimps' })
    expect(url).toBe('https://is1-ssl.mzstatic.com/x/600x600bb.jpg')
  })
})
