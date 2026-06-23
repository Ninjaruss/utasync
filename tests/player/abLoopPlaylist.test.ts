import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  shouldAdvancePlaylistAfterCycle,
  wrapPlaylistIndex,
  wrapPlaylistIndexPrev,
  playlistRepeatHelpText,
  playlistRepeatButtonLabel,
  scrollElementInContainer,
} from '../../src/player/abLoopPlaylist'

describe('wrapPlaylistIndex', () => {
  it('wraps from the last entry back to the first', () => {
    expect(wrapPlaylistIndex(2, 3)).toBe(0)
  })

  it('advances within range', () => {
    expect(wrapPlaylistIndex(0, 3)).toBe(1)
  })
})

describe('wrapPlaylistIndexPrev', () => {
  it('wraps from the first entry to the last', () => {
    expect(wrapPlaylistIndexPrev(0, 3)).toBe(2)
  })
})

describe('playlistRepeatButtonLabel', () => {
  it('labels finite and infinite repeat counts', () => {
    expect(playlistRepeatButtonLabel(3)).toBe('Repeats: 3×')
    expect(playlistRepeatButtonLabel(0)).toBe('Repeats: ∞')
  })
})

describe('shouldAdvancePlaylistAfterCycle', () => {
  it('does not advance when repeat count is infinite', () => {
    expect(shouldAdvancePlaylistAfterCycle(99, 0)).toBe(false)
  })

  it('advances after the configured repeat count', () => {
    expect(shouldAdvancePlaylistAfterCycle(2, 3)).toBe(false)
    expect(shouldAdvancePlaylistAfterCycle(3, 3)).toBe(true)
  })
})

describe('playlistRepeatHelpText', () => {
  it('mentions wrapping for finite repeat presets', () => {
    expect(playlistRepeatHelpText(3)).toMatch(/wrap/i)
  })
})

describe('scrollElementInContainer', () => {
  let container: HTMLDivElement
  let item: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    container.style.height = '100px'
    container.style.overflow = 'auto'
    Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true })
    container.scrollTop = 0
    container.scrollTo = vi.fn((opts: ScrollToOptions) => {
      if (typeof opts.top === 'number') container.scrollTop = opts.top
    })

    item = document.createElement('div')
    item.getBoundingClientRect = () => ({
      top: 180,
      bottom: 220,
      left: 0,
      right: 0,
      width: 0,
      height: 40,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    })
    container.getBoundingClientRect = () => ({
      top: 0,
      bottom: 100,
      left: 0,
      right: 0,
      width: 0,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    container.appendChild(item)
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('scrolls down when the item is below the visible area', () => {
    scrollElementInContainer(container, item, { behavior: 'auto', align: 'nearest' })
    expect(container.scrollTop).toBe(120)
  })
})
