import { describe, it, expect } from 'vitest'

/**
 * The suite must never reach the real network. Ten test files render the
 * add-song flow, which awaits resolveCoverArt -> a real request to
 * itunes.apple.com with a 5s timeout. Vitest's own testTimeout is also 5s, so
 * those tests were a dead heat between the two, decided by live network
 * conditions — which is exactly why they failed intermittently and differently
 * on every machine.
 *
 * The setup file installs a guard so an unmocked request fails LOUDLY and
 * instantly instead of hanging. A test that genuinely needs fetch installs its
 * own, which overrides this.
 */
describe('network guard', () => {
  it('refuses an unmocked request, naming the URL', async () => {
    await expect(fetch('https://itunes.apple.com/search?term=x'))
      .rejects.toThrow(/itunes\.apple\.com/)
  })

  it('explains how to fix it rather than just failing', async () => {
    await expect(fetch('https://example.test/a')).rejects.toThrow(/mock/i)
  })
})
