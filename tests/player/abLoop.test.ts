import { describe, it, expect, vi } from 'vitest'
import { ABLoopController } from '../../src/player/ABLoop'

describe('ABLoopController', () => {
  it('seeks back to A when position reaches B', () => {
    const seek = vi.fn()
    const controller = new ABLoopController(
      seek,
      () => ({ a: 10, b: 20, preRoll: 0, loopCount: 0, crossfadeDuration: 0 }),
      () => 20,
    )
    controller.tick()
    expect(seek).toHaveBeenCalledWith(10)
  })

  it('does nothing when the loop is incomplete', () => {
    const seek = vi.fn()
    const controller = new ABLoopController(
      seek,
      () => ({ a: 10, b: null, preRoll: 0, loopCount: 0, crossfadeDuration: 0 }),
      () => 20,
    )
    controller.tick()
    expect(seek).not.toHaveBeenCalled()
  })

  it('does nothing before B is reached', () => {
    const seek = vi.fn()
    const controller = new ABLoopController(
      seek,
      () => ({ a: 10, b: 20, preRoll: 0, loopCount: 0, crossfadeDuration: 0 }),
      () => 15,
    )
    controller.tick()
    expect(seek).not.toHaveBeenCalled()
  })

  it('calls onLoopCycle when wrapping from B to A', () => {
    const seek = vi.fn()
    const onLoopCycle = vi.fn()
    const controller = new ABLoopController(
      seek,
      () => ({ a: 10, b: 20, preRoll: 0, loopCount: 0, crossfadeDuration: 0 }),
      () => 20,
      onLoopCycle,
    )
    controller.tick()
    expect(onLoopCycle).toHaveBeenCalledOnce()
    expect(seek).toHaveBeenCalledWith(10)
  })
})
