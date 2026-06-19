import { describe, it, expect, beforeEach } from 'vitest'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'

describe('LyricsStore display prefs', () => {
  beforeEach(() => {
    useLyricsStore.setState({
      showTranslation: true,
      lyricsLayout: 'stacked',
    })
  })

  it('resets lyricsLayout to stacked when translation is turned off', () => {
    useLyricsStore.setState({ lyricsLayout: 'sideBySide' })
    useLyricsStore.getState().setShowTranslation(false)
    expect(useLyricsStore.getState().showTranslation).toBe(false)
    expect(useLyricsStore.getState().lyricsLayout).toBe('stacked')
  })

  it('preserves side-by-side layout when translation stays on', () => {
    useLyricsStore.setState({ lyricsLayout: 'sideBySide' })
    useLyricsStore.getState().setShowTranslation(true)
    expect(useLyricsStore.getState().lyricsLayout).toBe('sideBySide')
  })
})
