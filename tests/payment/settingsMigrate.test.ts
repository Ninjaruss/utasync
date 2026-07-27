import { describe, it, expect } from 'vitest'
import { migrateSettings } from '../../src/payment/SettingsStore'

/**
 * The v0→v1 migration underpins default-on vocal isolation for RETURNING users:
 * every v0 install persisted vocalSeparationEnabled:false as the opt-in default,
 * which — without this migration — would pin them OFF forever under the new
 * tri-state semantics. Clearing the stale key lets the new default (on when
 * supported) apply, while leaving every other setting untouched.
 */
describe('migrateSettings (v0 → v1)', () => {
  it('drops the stale opt-in default so returning users get default-on', () => {
    const v0 = { vocalSeparationEnabled: false, readingMode: 'dictionary', theme: 'dark' }
    const out = migrateSettings(v0, 0) as Record<string, unknown>
    expect('vocalSeparationEnabled' in out).toBe(false)
    // Untouched siblings survive.
    expect(out.readingMode).toBe('dictionary')
    expect(out.theme).toBe('dark')
  })

  it('also clears a stale explicit true (re-defaults everyone to the new policy)', () => {
    const v0 = { vocalSeparationEnabled: true }
    const out = migrateSettings(v0, 0) as Record<string, unknown>
    expect('vocalSeparationEnabled' in out).toBe(false)
  })

  it('leaves already-migrated (v1) state alone', () => {
    const v1 = { vocalSeparationEnabled: false }
    const out = migrateSettings(v1, 1) as Record<string, unknown>
    // An explicit choice made under v1 must be preserved.
    expect(out.vocalSeparationEnabled).toBe(false)
  })

  it('tolerates a null/absent persisted blob', () => {
    expect(migrateSettings(null, 0)).toBe(null)
    expect(migrateSettings(undefined, 0)).toBe(undefined)
  })
})
