import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider, useToast } from '../../../src/core/ui/Toast'

function Trigger({ message, type }: { message: string; type?: 'info' | 'warning' | 'error' }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast(message, type)}>
      fire
    </button>
  )
}

function renderToast(message: string, type?: 'info' | 'warning' | 'error') {
  render(
    <ToastProvider>
      <Trigger message={message} type={type} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByText('fire'))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast durations', () => {
  it('auto-dismisses info toasts after ~4s', () => {
    renderToast('Saved', 'info')
    expect(screen.getByText('Saved')).toBeTruthy()

    act(() => vi.advanceTimersByTime(3999))
    expect(screen.getByText('Saved')).toBeTruthy()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('keeps an instructional warning toast up well past 4s so it can be read', () => {
    // ~110 chars, like the LibraryScreen audio-delete warning.
    const message = 'w'.repeat(110)
    renderToast(message, 'warning')

    // Still mounted at t=4.5s (old behavior dismissed everything at 4s).
    act(() => vi.advanceTimersByTime(4500))
    expect(screen.getByText(message)).toBeTruthy()

    // 110 chars * 60ms = 6600 < 8000 floor → dismissed at 8s.
    act(() => vi.advanceTimersByTime(3500))
    expect(screen.queryByText(message)).toBeNull()
  })

  it('scales error toast duration with message length beyond the 8s floor', () => {
    const message = 'e'.repeat(150) // 150 * 60ms = 9000ms
    renderToast(message, 'error')

    act(() => vi.advanceTimersByTime(8500))
    expect(screen.getByText(message)).toBeTruthy()

    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByText(message)).toBeNull()
  })

  it('still allows manual dismissal via the close button', () => {
    renderToast('w'.repeat(110), 'warning')
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText('w'.repeat(110))).toBeNull()
  })
})
