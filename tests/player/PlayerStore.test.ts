import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayerStore, DEFAULT_VOLUME } from '../../src/player/PlayerStore'

describe('PlayerStore volume', () => {
  it('uses a safe default volume for new sessions', () => {
    expect(DEFAULT_VOLUME).toBe(0.75)
  })
})

describe('PlayerStore A/B arming', () => {
  beforeEach(() => usePlayerStore.setState({ armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } }))

  it('arms an endpoint', () => {
    usePlayerStore.getState().armAB('a')
    expect(usePlayerStore.getState().armingAB).toBe('a')
  })

  it('clears arming when an endpoint is set', () => {
    usePlayerStore.getState().armAB('b')
    usePlayerStore.getState().setABLoop({ b: 12 })
    expect(usePlayerStore.getState().abLoop.b).toBe(12)
    expect(usePlayerStore.getState().armingAB).toBe(null)
  })
})

describe('PlayerStore song switching', () => {
  beforeEach(() => usePlayerStore.setState({ currentSongId: 'song-1', armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } }))

  // A/B endpoints are timestamps in one song's audio. Carrying them to a
  // different song would seek the wrong moments (and they used to persist to
  // localStorage unkeyed by song).
  it('clears a set A/B loop and arming when switching songs', () => {
    usePlayerStore.getState().setABLoop({ a: 5, b: 8 })
    usePlayerStore.getState().armAB('a')
    usePlayerStore.getState().setCurrentSong('song-2')
    const s = usePlayerStore.getState()
    expect(s.currentSongId).toBe('song-2')
    expect(s.abLoop.a).toBeNull()
    expect(s.abLoop.b).toBeNull()
    expect(s.armingAB).toBeNull()
  })
})
