import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadJmdictGloss,
  prepareJmdictStemIndex,
  jmdictLemmaKeysForStem,
  jmdictGlossLoaded,
  resetJmdictGlossCache,
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
