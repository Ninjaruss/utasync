import { describe, it, expect } from 'vitest'
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LEGAL_PATHS } from '../../src/core/legal'

describe('legal constants', () => {
  it('exposes stable public paths for static policy pages', () => {
    expect(LEGAL_PATHS.privacy).toBe('/privacy/')
    expect(LEGAL_PATHS.terms).toBe('/terms/')
  })

  it('includes contact email and last-updated stamp', () => {
    expect(LEGAL_CONTACT_EMAIL).toMatch(/@/)
    expect(LEGAL_LAST_UPDATED.length).toBeGreaterThan(0)
  })
})
