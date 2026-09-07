import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

// No dedicated test previously covered the row-16 "Replace lyrics" dialog at
// all — this is the coverage this migration adds, not just re-verifies. It
// stands alone rather than joining tests/core/ui/overlaySurfaces.tsx because
// reaching the dialog means rendering the whole PlayerView, entering Edit
// mode, and opening a nested "More" menu — a much heavier precondition chain
// than any surface already registered there (see the comment on
// OVERLAY_SURFACES for the analogous reasoning applied to AutoAlignFlow).
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

// The panel searches lrclib on mount; stub it out so the dialog settles on the
// manual-paste screen instead of racing a real network call in jsdom.
vi.mock('../../src/sources/lyricsResolver', () => ({
  resolveLyricsForSong: vi.fn(async () => ({ lines: [], synced: false, source: 'none' })),
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

async function openReplaceLyricsDialog() {
  render(<PlayerView songId="song1" onBack={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Replace lyrics' }))
  // Let the mocked search settle before probing close behavior — while it's
  // still in flight the panel reports itself busy, and closing routes through
  // a "still searching" confirmation instead of closing outright. The panel's
  // own "busy" flag reaches the dialog a render after its "no automatic match"
  // text does (a child effect reporting up to the parent), so flush one more
  // tick past that text appearing rather than racing it under load.
  await screen.findByText(/no automatic match/i)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('PlayerView — replace-lyrics dialog', () => {
  it('is announced as a modal dialog and traps focus inside itself', async () => {
    await openReplaceLyricsDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Replace lyrics' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // Regression: the aria-hidden backdrop button sits before the panel in the
    // DOM. If it were still focusable, focusableWithin()[0] would land here —
    // the panel's own "Close" button — instead of on it.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })))
  })

  it('closes on Escape', async () => {
    await openReplaceLyricsDialog()
    await screen.findByRole('dialog', { name: 'Replace lyrics' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace lyrics' })).toBeNull())
  })

  it('closes on a click on the backdrop', async () => {
    await openReplaceLyricsDialog()
    await screen.findByRole('dialog', { name: 'Replace lyrics' })
    // aria-hidden, by design (rule 1) — so it's invisible to getByRole and has
    // to be reached directly, the same way a screen reader would skip it.
    const backdrop = document.querySelector('button[aria-label="Dismiss"]')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace lyrics' })).toBeNull())
  })

  it('keeps every existing exit control: the visible close button still works', async () => {
    await openReplaceLyricsDialog()
    await screen.findByRole('dialog', { name: 'Replace lyrics' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace lyrics' })).toBeNull())
  })
})
