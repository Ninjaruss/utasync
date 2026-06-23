import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const updateServiceWorker = vi.fn()
let needRefresh = false

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, vi.fn()],
    updateServiceWorker,
  }),
}))

import { UpdateBanner } from '../../../src/core/ui/UpdateBanner'

describe('UpdateBanner', () => {
  it('renders nothing when no update is pending', () => {
    needRefresh = false
    render(<UpdateBanner />)
    expect(screen.queryByText(/new version available/i)).toBeNull()
  })

  it('shows a prompt and reloads via updateServiceWorker on click', () => {
    needRefresh = true
    render(<UpdateBanner />)
    const button = screen.getByRole('button', { name: /update/i })
    fireEvent.click(button)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
