import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadJmdictGloss,
  prepareJmdictStemIndex,
  jmdictLemmaKeysForStem,
  jmdictGlossLoaded,
  resetJmdictGlossCache,
  getJmdictAltGlosses,
  getJmdictRomajiGloss,
  getJmdictKanjiRomaji,
  getJmdictKanjiGloss,
} from '../../src/ai-pipeline/jmdictGloss'

const fixture = {
  v: 1,
  source: 'test',
  romaji: {
    sukue: 'save',
    sukui: 'salvation',
    mogaku: 'struggle',
  },
  kanji: {
    救: 'sukue',
  },
  kanjiGloss: {
    救: 'save (a soul)',
  },
  alt: {
    mae: 'front|before',
    sukue: 'rescue',
  },
}

function okResponse() {
  return { ok: true, json: async () => fixture } as Response
}

describe('jmdictGloss fetch failure recovery', () => {
  let now: number

  beforeEach(() => {
    resetJmdictGlossCache()
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetJmdictGlossCache()
  })

  it('rebuilds the stem prefix index after a failed load followed by a successful one', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await prepareJmdictStemIndex()
    expect(jmdictGlossLoaded()).toBe(false)
    expect(jmdictLemmaKeysForStem('suku')).toEqual([])

    // Network comes back; move past any retry backoff window.
    fetchMock.mockResolvedValue(okResponse())
    now += 10 * 60_000

    await prepareJmdictStemIndex()
    expect(jmdictGlossLoaded()).toBe(true)
    expect(jmdictLemmaKeysForStem('suku')).toEqual(
      expect.arrayContaining(['sukue', 'sukui']),
    )
  })

  it('does not re-fetch the gloss file on every call while offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await loadJmdictGloss()
    await loadJmdictGloss()
    await loadJmdictGloss()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries the fetch once the failure backoff has elapsed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await loadJmdictGloss()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now += 10 * 60_000
    fetchMock.mockResolvedValue(okResponse())

    const result = await loadJmdictGloss()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result?.romaji.sukue).toBe('save')
    expect(jmdictGlossLoaded()).toBe(true)
  })
})

/**
 * These assertions go through the REAL loader (`fetch` stubbed, payload passed as
 * JSON) rather than `setJmdictGlossForTests`, which assigns the object wholesale.
 * The distinction is the whole point: the loader literal dropped `alt`, so the
 * secondary-sense feature was inert in production while its dedicated test stayed
 * green by injecting a payload the loader never produces.
 */
describe('jmdictGloss loader preserves every field its readers consume', () => {
  beforeEach(() => {
    resetJmdictGlossCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetJmdictGlossCache()
  })

  it('keeps the secondary senses, so getJmdictAltGlosses is not inert', async () => {
    await loadJmdictGloss()

    expect(getJmdictAltGlosses('mae')).toEqual(['front', 'before'])
    expect(getJmdictAltGlosses('sukue')).toEqual(['rescue'])
    // A key with no recorded second sense is empty, not a crash.
    expect(getJmdictAltGlosses('mogaku')).toEqual([])
    // Lookup is case/space insensitive, as the reader trims and lowercases.
    expect(getJmdictAltGlosses('  MAE ')).toEqual(['front', 'before'])
  })

  it('round-trips the primary, kanji, and popover maps as well', async () => {
    await loadJmdictGloss()

    expect(getJmdictRomajiGloss('sukue')).toBe('save')
    expect(getJmdictKanjiRomaji('救')).toBe('sukue')
    expect(getJmdictKanjiGloss('救')).toBe('save (a soul)')
  })
})
