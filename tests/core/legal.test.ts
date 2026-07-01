import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LEGAL_PATHS } from '../../src/core/legal'

const ROOT = join(import.meta.dirname, '../..')

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

describe('static legal pages', () => {
  it('privacy policy exists and references current payment and data practices', () => {
    const html = readFileSync(join(ROOT, 'public/privacy/index.html'), 'utf8')
    expect(html).toContain('Privacy Policy')
    expect(html).toContain(LEGAL_LAST_UPDATED)
    expect(html).toContain('Payhip')
    expect(html).toContain('lyrics.ovh')
    expect(html).toContain(LEGAL_CONTACT_EMAIL)
    expect(html).not.toContain('Lemon Squeezy')
  })

  it('terms of service exists and references current payment provider', () => {
    const html = readFileSync(join(ROOT, 'public/terms/index.html'), 'utf8')
    expect(html).toContain('Terms of Service')
    expect(html).toContain(LEGAL_LAST_UPDATED)
    expect(html).toContain('Payhip')
    expect(html).toContain(LEGAL_CONTACT_EMAIL)
    expect(html).not.toContain('Lemon Squeezy')
  })
})
