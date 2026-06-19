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
