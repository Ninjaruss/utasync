import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Banner } from '../../src/core/ui/Banner'

describe('Banner', () => {
  it('renders message text at text-xs', () => {
    render(<Banner severity="info">Hello there</Banner>)
    const p = screen.getByText('Hello there')
    expect(p.className).toContain('text-xs')
  })

  it('defaults error/warning to role=alert and info/action to role=status', () => {
    const { rerender } = render(<Banner severity="error">boom</Banner>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<Banner severity="info">note</Banner>)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('fires the action and shows a busy spinner', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <Banner severity="action" action={{ label: 'Do it', onClick }}>msg</Banner>,
    )
    fireEvent.click(screen.getByRole('button', { name: /do it/i }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<Banner severity="action" action={{ label: 'Do it', onClick, busy: true }}>msg</Banner>)
    expect(screen.getByRole('button', { name: /do it/i })).toBeDisabled()
  })

  it('renders a dismiss control only when onDismiss is given', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Banner severity="info">msg</Banner>)
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull()
    rerender(<Banner severity="info" onDismiss={onDismiss}>msg</Banner>)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
