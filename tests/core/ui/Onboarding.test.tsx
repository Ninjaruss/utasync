import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Onboarding, ONBOARDING_STORAGE_KEY } from '../../../src/core/ui/Onboarding'

describe('Onboarding', () => {
  beforeEach(() => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  })

  it('shows the first step when never seen before', () => {
    render(<Onboarding />)
    expect(screen.getByText(/add a song/i)).toBeTruthy()
  })

  it('renders nothing once already seen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    render(<Onboarding />)
    expect(screen.queryByText(/add a song/i)).toBeNull()
  })

  it('advances through all three steps then dismisses and persists', () => {
    render(<Onboarding />)
    expect(screen.getByText(/add a song/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/sync lyrics/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/practice/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.queryByText(/practice/i)).toBeNull()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
  })

  it('skip dismisses immediately and persists', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(screen.queryByText(/add a song/i)).toBeNull()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
  })
})
