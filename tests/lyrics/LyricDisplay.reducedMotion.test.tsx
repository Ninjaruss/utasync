import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

const LINES: TimedLine[] = Array.from({ length: 6 }, (_, i) => ({
  original: `line ${i}`, translation: '', startTime: i * 5, endTime: i * 5 + 4,
}))

let scrollIntoView: ReturnType<typeof vi.fn>
const originalMatchMedia = window.matchMedia

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollIntoView
  useLyricsStore.setState({
    lines: LINES, activeLine: 0,
    furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked',
  })
})
afterEach(() => { window.matchMedia = originalMatchMedia })

const advance = (i: number) => act(() => { useLyricsStore.setState({ activeLine: i }) })

describe('follow-along scrolling and reduced motion', () => {
  // The karaoke scroll fires every few seconds for a whole song — the app's
  // most motion-heavy behaviour, and it had no opt-out.
  it('jumps instead of animating when the user asks for reduced motion', () => {
    setReducedMotion(true)
    render(<LyricDisplay onLineClick={() => {}} />)
    scrollIntoView.mockClear()

    advance(1)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView.mock.calls.at(-1)![0]).toMatchObject({ behavior: 'auto' })
  })

  it('animates normally when no preference is set', () => {
    setReducedMotion(false)
    render(<LyricDisplay onLineClick={() => {}} />)
    scrollIntoView.mockClear()

    advance(1)
    expect(scrollIntoView.mock.calls.at(-1)![0]).toMatchObject({ behavior: 'smooth' })
  })

  it('still centres the line — the scroll is dampened, not dropped', () => {
    setReducedMotion(true)
    render(<LyricDisplay onLineClick={() => {}} />)
    scrollIntoView.mockClear()

    advance(2)
    expect(scrollIntoView.mock.calls.at(-1)![0]).toMatchObject({ block: 'center' })
  })
})
