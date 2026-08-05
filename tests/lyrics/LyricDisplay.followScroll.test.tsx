import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

const LINES: TimedLine[] = Array.from({ length: 12 }, (_, i) => ({
  original: `line ${i}`,
  translation: `translation ${i}`,
  startTime: i * 5,
  endTime: i * 5 + 4,
}))

let scrollIntoView: ReturnType<typeof vi.fn>

/** jsdom has no layout, so "is the active line on screen?" has to be faked.
 * `visible` decides what the active row's rect looks like relative to the
 * scroll container. */
function stubGeometry(visible: boolean) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isContainer = this.className.includes('overflow-y-auto')
    if (isContainer) return { top: 0, bottom: 600, height: 600, left: 0, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    const top = visible ? 200 : 2000
    return { top, bottom: top + 60, height: 60, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
}

const setActive = (i: number) => act(() => { useLyricsStore.setState({ activeLine: i }) })

beforeEach(() => {
  vi.restoreAllMocks()
  scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollIntoView
  useLyricsStore.setState({
    lines: LINES, activeLine: 0,
    furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked',
  })
  stubGeometry(true)
})

describe('LyricDisplay follow-along scrolling', () => {
  it('keeps the active line centred while the user is not scrolling', () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    scrollIntoView.mockClear()
    setActive(1)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('stops yanking the view back once the user scrolls away', () => {
    const { container } = render(<LyricDisplay onLineClick={() => {}} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    stubGeometry(false) // user has scrolled the active line off screen
    fireEvent.wheel(scroller, { deltaY: -200 })
    scrollIntoView.mockClear()

    setActive(1)
    setActive(2)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('treats a touch drag as the same intent', () => {
    const { container } = render(<LyricDisplay onLineClick={() => {}} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    stubGeometry(false)
    fireEvent.touchMove(scroller, { touches: [{ clientX: 0, clientY: 10 }] })
    scrollIntoView.mockClear()

    setActive(1)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('offers a way back to the song, and following resumes when taken', () => {
    const { container } = render(<LyricDisplay onLineClick={() => {}} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    stubGeometry(false)
    fireEvent.wheel(scroller, { deltaY: -200 })
    setActive(1)

    const jump = screen.getByRole('button', { name: /jump to current line/i })
    scrollIntoView.mockClear()
    fireEvent.click(jump)
    expect(scrollIntoView).toHaveBeenCalled()

    // Following is live again.
    scrollIntoView.mockClear()
    setActive(2)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /jump to current line/i })).toBeNull()
  })

  it('does not offer the jump control while following normally', () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    setActive(1)
    expect(screen.queryByRole('button', { name: /jump to current line/i })).toBeNull()
  })

  it('resumes on its own once the song scrolls back into view', () => {
    const { container } = render(<LyricDisplay onLineClick={() => {}} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    stubGeometry(false)
    fireEvent.wheel(scroller, { deltaY: -200 })
    setActive(1)
    expect(screen.getByRole('button', { name: /jump to current line/i })).toBeTruthy()

    // The user scrolls back to where the song actually is.
    stubGeometry(true)
    scrollIntoView.mockClear()
    fireEvent.scroll(scroller)

    expect(screen.queryByRole('button', { name: /jump to current line/i })).toBeNull()
    setActive(2)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('resumes when the user taps a line to seek', () => {
    const onLineClick = vi.fn()
    const { container } = render(<LyricDisplay onLineClick={onLineClick} />)
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    stubGeometry(false)
    fireEvent.wheel(scroller, { deltaY: -200 })
    setActive(1)
    expect(screen.getByRole('button', { name: /jump to current line/i })).toBeTruthy()

    fireEvent.click(screen.getByText('line 5'))
    expect(onLineClick).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /jump to current line/i })).toBeNull()
  })
})
