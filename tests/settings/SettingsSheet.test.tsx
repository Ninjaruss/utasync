import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsSheet } from '../../src/settings/SettingsSheet'

vi.mock('../../src/settings/SettingsView', () => ({ SettingsView: () => <div>SETTINGS_BODY</div> }))

describe('SettingsSheet', () => {
  it('renders settings and closes on dismiss', () => {
    const onClose = vi.fn()
    render(<SettingsSheet onClose={onClose} />)
    expect(screen.getByText('SETTINGS_BODY')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
