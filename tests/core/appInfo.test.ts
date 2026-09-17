import { describe, it, expect } from 'vitest'
import { APP_REPO_URL, appBuildTime, formatAppBuildTime } from '../../src/core/appInfo'

describe('appInfo build metadata', () => {
  it('exposes the canonical source repository', () => {
    expect(APP_REPO_URL).toBe('https://github.com/Ninjaruss/utasync')
  })

  it('reads the build timestamp injected by vite define', () => {
    // Defined in vite.config.ts, which every build (and the test run) goes
    // through. A value that is missing or unparseable would silently disable
    // the "App last updated" row, so assert it is a real ISO instant.
    expect(appBuildTime()).toBe(__APP_BUILD_TIME__)
    expect(Number.isNaN(new Date(appBuildTime()).getTime())).toBe(false)
  })

  it('formats a timestamp for display in the reader locale', () => {
    const label = formatAppBuildTime('2026-03-03T16:12:00.000Z')
    expect(label).not.toMatch(/invalid/i)
    // Locale-independent anchors: the year is never dropped by dateStyle.
    expect(label).toContain('2026')
    expect(label).toBe(new Date('2026-03-03T16:12:00.000Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))
  })

  it('returns an empty string rather than "Invalid Date" for unusable input', () => {
    expect(formatAppBuildTime('')).toBe('')
    expect(formatAppBuildTime('not a date')).toBe('')
  })
})
