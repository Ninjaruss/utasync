import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsSheet } from '../../src/settings/SettingsSheet'

vi.mock('../../src/settings/SettingsView', () => ({ SettingsView: () => <div>SETTINGS_BODY</div> }))

describe('SettingsSheet', () => {
  it('renders settings and closes on dismiss', () => {
    const onClose = vi.fn()
    render(<SettingsSheet onClose={onClose} />)
    expect(screen.getByText('SETTINGS_BODY')).toBeTruthy()
    // The backdrop is aria-hidden (see the initial-focus test below). getByRole's
    // `name` matcher computes an empty accessible name for an aria-hidden
    // element even with `hidden: true` (that option only restores the element
    // to the role query, not to name computation), so it has to be picked out
    // by its aria-label attribute directly.
    const backdrop = screen
      .getAllByRole('button', { hidden: true })
      .find((el) => el.getAttribute('aria-label') === 'Close')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not put initial focus on the invisible backdrop button', () => {
    // The backdrop button is a full-screen sibling inside the focus trap. Before
    // it was marked aria-hidden, useModalDialog's `focusableWithin` resolved it
    // as the panel's first focusable element, so a keyboard/screen-reader user
    // opening the sheet landed on an invisible "Close" control instead of a real
    // one. SettingsView is mocked to a plain div here with no focusable content
    // of its own, so the trap falls back to the panel itself.
    render(<SettingsSheet onClose={vi.fn()} />)
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Close')
  })
})
