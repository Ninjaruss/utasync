import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Onboarding, ONBOARDING_STORAGE_KEY } from '../../../src/core/ui/Onboarding'
import { AddSongSheet } from '../../../src/sources/AddSongSheet'
import { SettingsSheet } from '../../../src/settings/SettingsSheet'
import { OVERLAY_SURFACES } from './overlaySurfaces'

beforeEach(() => {
  localStorage.clear()
})

/** Every blocking overlay in the app should behave the same way: announce
 * itself, hold focus, and close on Escape. */
describe.each(OVERLAY_SURFACES)('$name as a modal dialog', ({ open }) => {
  it('is announced as a modal dialog', async () => {
    open()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby')).toBeTruthy()
  })

  it('moves focus inside itself rather than leaving it on the page behind', async () => {
    open()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('closes on Escape', async () => {
    const expectClosed = open()
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await expectClosed()
  })
})

describe('sheets and the system Back gesture', () => {
  const goBack = async () => {
    await act(async () => {
      window.history.back()
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  it('Back closes the Add-song sheet instead of leaving the app', async () => {
    window.history.replaceState(null, '', '/')
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    await screen.findByRole('dialog')

    await goBack()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Back closes the Settings sheet', async () => {
    window.history.replaceState(null, '', '/')
    const onClose = vi.fn()
    render(<SettingsSheet onClose={onClose} />)
    await screen.findByRole('dialog')

    await goBack()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('Onboarding', () => {
  it('does not appear for a returning visitor who already dismissed it', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    const { container } = render(<Onboarding />)
    expect(container.firstChild).toBeNull()
  })

  it('remembers the dismissal when closed with Escape', async () => {
    render(<Onboarding />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1'))
  })
})
