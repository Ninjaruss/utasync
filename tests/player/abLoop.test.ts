import { describe, it, expect, vi } from 'vitest'
import { ABLoopController } from '../../src/player/ABLoop'

describe('ABLoopController', () => {
  it('loops back to point A exactly, not before it', () => {
    const seek = vi.fn()
    const engine = { seek } as never
    const getLoop = () => ({ a: 10, b: 20, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 })
    const controller = new ABLoopController(engine, getLoop, () => 20)

    controller.tick()

    expect(seek).toHaveBeenCalledWith(10)
  })
})
