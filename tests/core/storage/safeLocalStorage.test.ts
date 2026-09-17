import { describe, it, expect, vi, afterEach } from 'vitest'
import { safeLocalStorage } from '../../../src/core/storage/safeLocalStorage'

describe('safeLocalStorage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads and writes normally when localStorage works', () => {
    safeLocalStorage.setItem('k', 'v')
    expect(safeLocalStorage.getItem('k')).toBe('v')
    safeLocalStorage.removeItem('k')
    expect(safeLocalStorage.getItem('k')).toBeNull()
  })

  it('returns null when getItem throws (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(safeLocalStorage.getItem('k')).toBeNull()
  })

  it('swallows a throwing setItem instead of propagating', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow()
  })

  it('swallows a throwing removeItem instead of propagating', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => safeLocalStorage.removeItem('k')).not.toThrow()
  })
})
