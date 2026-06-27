import { describe, it, expect, vi, afterEach } from 'vitest'
import { youtubeNeedsVisibleEmbed } from '../../src/player/youtubeEmbedPolicy'

describe('youtubeNeedsVisibleEmbed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true for Firefox user agents', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/128.0' })
    expect(youtubeNeedsVisibleEmbed()).toBe(true)
  })

  it('returns true for Zen (Gecko/Firefox-based) user agents', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0 Zen/1.0',
    })
    expect(youtubeNeedsVisibleEmbed()).toBe(true)
  })

  it('returns false for Chromium user agents', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    })
    expect(youtubeNeedsVisibleEmbed()).toBe(false)
  })
})
