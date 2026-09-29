import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'
import { APP_REPO_URL, appBuildTime, formatAppBuildTime } from '../../src/core/appInfo'
import { LEGAL_LAST_UPDATED, SUPPORT_URL } from '../../src/core/legal'

vi.mock('../../src/core/storage/quota', () => ({
  estimateStorageBreakdown: async () => ({
    used: 0,
    total: 1,
    ratio: 0,
    modelCache: 0,
    songsAudio: 0,
    other: 0,
  }),
  formatBytes: (n: number) => `${n} B`,
}))

vi.mock('../../src/core/storage/cleanup', () => ({
  findOrphanedAudioIds: async () => [],
  deleteOrphanedAudio: async () => {},
}))

describe('SettingsView app information', () => {
  beforeEach(async () => {
    await db.songs.clear()
  })

  it('shows the build time of the running version', async () => {
    const { container } = render(<SettingsView onClose={() => {}} embedded />)
    expect(await screen.findByText('App last updated')).toBeTruthy()

    const time = container.querySelector('time')
    expect(time).not.toBeNull()
    expect(time).toHaveAttribute('datetime', appBuildTime())
    expect(time?.textContent).toBe(formatAppBuildTime(appBuildTime()))
    expect(time?.textContent).not.toMatch(/invalid/i)
  })

  it('links to the public repository in a safe new tab', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const link = await screen.findByRole('link', { name: /GitHub repository/ })
    expect(link).toHaveAttribute('href', APP_REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    const rel = link.getAttribute('rel') ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('links the optional support newsletter in a safe new tab', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const link = await screen.findByRole('link', { name: /support on substack/i })
    // The URL comes from the legal constant, so the link and the policy pages
    // cannot point at different places.
    expect(link).toHaveAttribute('href', SUPPORT_URL)
    expect(link).toHaveAttribute('target', '_blank')
    const rel = link.getAttribute('rel') ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  // The app is free and has no paid tier; the newsletter is a separate
  // publication. Copy that blurred the two would misdescribe the product.
  it('describes support as separate from the app and unlocking nothing', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const card = (await screen.findByText('Support Utasync')).closest('div')?.parentElement
    expect(card?.textContent).toMatch(/free and runs entirely on your device/i)
    expect(card?.textContent).toMatch(/unlocks nothing/i)
    // No trace of the retired paid-tier story.
    expect(card?.textContent).not.toMatch(/pro\b/i)
    expect(card?.textContent).not.toMatch(/patreon/i)
  })

  it('keeps the legal card as its own section below the app information', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    // Regression guard: the build-time row moved out of the legal card, but the
    // policy links and their own last-updated stamp must stay there.
    const legalCard = screen.getByText('Legal').closest('div')
    expect(legalCard?.textContent).toContain(LEGAL_LAST_UPDATED)
    expect(legalCard?.textContent).not.toContain('App last updated')

    const appCard = screen.getByText('App information').closest('div')
    expect(appCard?.textContent).toContain('App last updated')
    expect(appCard?.textContent).toContain('GitHub repository')
    expect(appCard?.textContent).not.toContain(LEGAL_LAST_UPDATED)
  })
})
