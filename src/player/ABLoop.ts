import type { ABLoop } from '../core/types'
import type { AudioEngine } from './AudioEngine'
import { isABLoopActive } from './abLoopUtils'

export class ABLoopController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private engine: AudioEngine
  private getLoop: () => ABLoop
  private getPosition: () => number

  constructor(
    engine: AudioEngine,
    getLoop: () => ABLoop,
    getPosition: () => number,
  ) {
    this.engine = engine
    this.getLoop = getLoop
    this.getPosition = getPosition
  }

  tick() {
    const loop = this.getLoop()
    if (!isABLoopActive(loop)) return
    const pos = this.getPosition()
    if (pos >= loop.b!) {
      this.engine.seek(Math.max(0, loop.a!))
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
