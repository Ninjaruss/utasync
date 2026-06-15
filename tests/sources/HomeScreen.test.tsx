// tests/sources/HomeScreen.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomeScreen } from '../../src/sources/HomeScreen'

describe('HomeScreen', () => {
  it('shows the YouTube link flow by default and switches to upload', () => {
    render(<HomeScreen onSongReady={() => {}} />)
    expect(screen.getByPlaceholderText(/youtube link/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /upload audio/i }))
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument()
  })
})
