import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadEnjaDict, getEnjaEntries, enjaDictLoaded, resetEnjaDictCache, setEnjaDictForTests } from '../../../src/language/english/enjaDict'

afterEach(() => { resetEnjaDictCache(); vi.unstubAllGlobals() })

describe('enjaDict loader', () => {
  it('reports not-loaded before a load, loaded after', async () => {
    expect(enjaDictLoaded()).toBe(false)
    setEnjaDictForTests({ v: 1, source: 'test', entries: { spring: [{ w: '春', r: 'はる' }] } })
    expect(enjaDictLoaded()).toBe(true)
    expect(getEnjaEntries('spring')).toEqual([{ w: '春', r: 'はる' }])
    expect(getEnjaEntries('missing')).toBeUndefined()
  })

  it('returns null on fetch failure and reports not-loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await loadEnjaDict()).toBeNull()
    expect(enjaDictLoaded()).toBe(false)
  })

  it('loads and caches the JSON on success', async () => {
    const body = { v: 1, source: 'jmdict-eng', entries: { umbrella: [{ w: '傘', r: 'かさ' }] } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }))
    const data = await loadEnjaDict()
    expect(data?.entries.umbrella).toEqual([{ w: '傘', r: 'かさ' }])
    expect(getEnjaEntries('umbrella')).toEqual([{ w: '傘', r: 'かさ' }])
  })

  it('returns undefined for a prototype-member key not present in the data', () => {
    setEnjaDictForTests({ v: 1, source: 'test', entries: { spring: [{ w: '春', r: 'はる' }] } })
    expect(getEnjaEntries('constructor')).toBeUndefined()
    expect(getEnjaEntries('toString')).toBeUndefined()
  })
})
