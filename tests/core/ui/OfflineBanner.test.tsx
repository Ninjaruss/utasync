import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { OfflineBanner } from '../../../src/core/ui/OfflineBanner'

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

describe('OfflineBanner', () => {
  afterEach(() => {
    cleanup()
    setOnline(true)
  })

  it('renders nothing while online', () => {
    setOnline(true)
    render(<OfflineBanner />)
    expect(screen.queryByText(/you.re offline/i)).toBeNull()
  })

  it('shows a message when the offline event fires', () => {
    setOnline(true)
    render(<OfflineBanner />)
    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/you.re offline/i)).toBeTruthy()
  })

  it('hides again when the online event fires', () => {
    setOnline(false)
    render(<OfflineBanner />)
    expect(screen.getByText(/you.re offline/i)).toBeTruthy()
    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(/you.re offline/i)).toBeNull()
  })
})
