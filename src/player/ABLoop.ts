import type { ABLoop } from '../core/types'
import { isABLoopActive } from './abLoopUtils'

export class ABLoopController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private seek: (seconds: number) => void
  private getLoop: () => ABLoop
  private getPosition: () => number

  constructor(
    seek: (seconds: number) => void,
    getLoop: () => ABLoop,
    getPosition: () => number,
  ) {
    this.seek = seek
    this.getLoop = getLoop
    this.getPosition = getPosition
  }

  tick() {
    const loop = this.getLoop()
    if (!isABLoopActive(loop)) return
    const pos = this.getPosition()
    if (pos >= loop.b!) {
      this.seek(Math.max(0, loop.a!))
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
