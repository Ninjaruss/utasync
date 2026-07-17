import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadEnDict, getEnDefinitions, enDictLoaded, resetEnDictCache, setEnDictForTests } from '../../../src/language/english/enDict'

afterEach(() => { resetEnDictCache(); vi.unstubAllGlobals() })

describe('enDict loader', () => {
  it('injects and reads definitions', () => {
    setEnDictForTests({ v: 1, source: 't', entries: { spring: ['the season of growth'] } })
    expect(enDictLoaded()).toBe(true)
    expect(getEnDefinitions('Spring')).toEqual(['the season of growth'])
    expect(getEnDefinitions('missing')).toBeUndefined()
  })
  it('returns null and stays not-loaded on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await loadEnDict()).toBeNull()
    expect(enDictLoaded()).toBe(false)
  })
  it('returns undefined for a prototype-member key not present in the data', () => {
    setEnDictForTests({ v: 1, source: 't', entries: { spring: ['the season of growth'] } })
    expect(getEnDefinitions('constructor')).toBeUndefined()
    expect(getEnDefinitions('hasOwnProperty')).toBeUndefined()
    expect(getEnDefinitions('toString')).toBeUndefined()
  })
})
