import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../src/core/db/schema'
import App from '../src/App'

vi.mock('../src/sources/AddSongSheet', () => ({ AddSongSheet: () => <div>ADD_SHEET</div> }))

beforeEach(async () => {
  await db.songs.clear()
})

describe('App navigation spine', () => {
  it('opens the Add sheet from the Library', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a song/i }))
    expect(screen.getByText('ADD_SHEET')).toBeTruthy()
  })
})
