import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, LEGAL_PATHS, SUPPORT_URL } from '../../src/core/legal'
import { APP_REPO_URL } from '../../src/core/appInfo'

const ROOT = join(import.meta.dirname, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PRIVACY = read('public/privacy/index.html')
const TERMS = read('public/terms/index.html')

/**
 * Utasync is free, MIT-licensed, and has no backend — and these pages have to say
 * that, not something else.
 *
 * These assertions used to demand the opposite: they required `Payhip` to appear
 * in both policies, which froze in place a Pro tier, licence keys, and a
 * licence-verification endpoint the app has never had (`grep -i licen src` → no
 * hits; the store that lived under `src/payment/` is now `src/settings/SettingsStore.ts`
 * and no payment code remains). A test that asserts policy
 * prose the code does not implement can only fail for the wrong reason, so it now
 * checks the claims that are true — and that the unshipped ones are gone.
 */
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
  it.each([
    ['privacy', PRIVACY, 'Privacy Policy'],
    ['terms', TERMS, 'Terms of Service'],
  ])('%s page exists, is stamped, and carries the shared links', (_name, html, title) => {
    expect(html).toContain(title)
    expect(html).toContain(LEGAL_LAST_UPDATED)
    expect(html).toContain(LEGAL_CONTACT_EMAIL)
    // The support link is asserted from the constant, so the page and the
    // Settings link cannot drift apart.
    expect(html).toContain(SUPPORT_URL)
  })

  // The claim the pages now make: free and open source, stated as fact.
  it('describes the app as free and open source, pointing at the real source', () => {
    expect(TERMS).toContain('MIT License')
    expect(TERMS).toContain(APP_REPO_URL)
    expect(TERMS).toMatch(/free to use/i)
    // The support link is explicitly not a purchase of the app.
    expect(TERMS).toMatch(/separate publication, not a purchase/i)
  })

  it('no longer promises a tier, licence key, or verification endpoint that does not exist', () => {
    for (const html of [PRIVACY, TERMS]) {
      expect(html).not.toContain('Payhip')
      expect(html).not.toContain('Lemon Squeezy')
      expect(html).not.toMatch(/Utasync Pro/)
      expect(html).not.toMatch(/free tier/i)
      expect(html).not.toContain('/api/verify-license')
      // The specific promises that were false. "…no licence key" is a true
      // negation and is allowed; telling the user to keep one is not.
      expect(html).not.toMatch(/licen[cs]e keys and unlock status/i)
      expect(html).not.toMatch(/your licen[cs]e key/i)
      expect(html).not.toMatch(/restore (?:your )?(?:purchase|licen[cs]e)/i)
    }
    // A device fingerprint is a data practice the app does not perform.
    expect(PRIVACY).not.toMatch(/device fingerprint/i)
  })

  // Every third party the app can actually contact, per the call sites
  // (src/sources/youtube*.ts, lrclib.ts, lyricsOvh.ts, coverArt.ts, the
  // transformers.js model downloads, and the Settings support link).
  it('names the third parties the app really contacts, and nothing it does not', () => {
    for (const party of ['YouTube', 'LRCLIB', 'lyrics.ovh', 'iTunes Search API', 'Hugging Face', 'Substack']) {
      expect(PRIVACY).toContain(party)
    }
    // The cover-art lookup sends title and artist to Apple, so a policy that
    // omitted it would be incomplete about a real outbound request.
    expect(PRIVACY).toContain('itunes.apple.com')
  })

  it('states there is no backend, which is the load-bearing privacy claim', () => {
    expect(PRIVACY).toMatch(/no backend/i)
    expect(PRIVACY).toMatch(/no analytics/i)
    // …and it must not then describe server-side processing.
    expect(PRIVACY).not.toMatch(/our server/i)
  })

  it('cross-links the two policies, so neither is a dead end', () => {
    expect(PRIVACY).toContain('href="/terms/"')
    expect(TERMS).toContain('href="/privacy/"')
  })
})
