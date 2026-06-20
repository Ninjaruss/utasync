import type { ABLoop } from '../core/types'
import { isABLoopActive } from './abLoopUtils'

export class ABLoopController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private seek: (seconds: number) => void
  private getLoop: () => ABLoop
  private getPosition: () => number
  private onLoopCycle: (() => void) | undefined
  private lastPos = 0

  constructor(
    seek: (seconds: number) => void,
    getLoop: () => ABLoop,
    getPosition: () => number,
    onLoopCycle?: () => void,
  ) {
    this.seek = seek
    this.getLoop = getLoop
    this.getPosition = getPosition
    this.onLoopCycle = onLoopCycle
  }

  tick() {
    const loop = this.getLoop()
    if (!isABLoopActive(loop)) {
      this.lastPos = this.getPosition()
      return
    }
    const pos = this.getPosition()
    if (this.lastPos < loop.b! && pos >= loop.b!) {
      this.onLoopCycle?.()
      const after = this.getLoop()
      if (isABLoopActive(after)) {
        this.seek(Math.max(0, after.a!))
        this.lastPos = after.a!
      }
      return
    }
    this.lastPos = pos
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer)
  }
}
