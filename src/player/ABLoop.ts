import type { ABLoop } from '../core/types'
import type { AudioEngine } from './AudioEngine'

export class ABLoopController {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private engine: AudioEngine,
    private getLoop: () => ABLoop,
    private getPosition: () => number,
  ) {}

  tick() {
    const loop = this.getLoop()
    if (loop.a === null || loop.b === null) return
    const pos = this.getPosition()
    if (pos >= loop.b) {
      this.engine.seek(loop.a - loop.preRoll)
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
