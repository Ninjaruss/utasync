import { Howl } from 'howler'

type TimeUpdateHandler = (position: number) => void
type StateHandler = () => void

export class AudioEngine {
  private howl: Howl | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private onTimeUpdateCb: TimeUpdateHandler | null = null
  private onEndCb: StateHandler | null = null

  onTimeUpdate(cb: TimeUpdateHandler) { this.onTimeUpdateCb = cb }
  onEnd(cb: StateHandler) { this.onEndCb = cb }

  load(src: string | File): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = src instanceof File ? URL.createObjectURL(src) : src
      this.destroy()
      this.howl = new Howl({
        src: [url],
        format: ['mp3', 'm4a', 'ogg'],
        html5: true,
        onload: () => resolve(),
        onloaderror: (_id, err) => reject(err),
        onend: () => { this.onEndCb?.(); this.stopTicker() },
      })
    })
  }

  play() {
    this.howl?.play()
    this.startTicker()
  }

  pause() {
    this.howl?.pause()
    this.stopTicker()
  }

  seek(seconds: number) {
    this.howl?.seek(seconds)
  }

  get position(): number {
    return (this.howl?.seek() as number) ?? 0
  }

  get duration(): number {
    return this.howl?.duration() ?? 0
  }

  private startTicker() {
    this.stopTicker()
    this.ticker = setInterval(() => {
      this.onTimeUpdateCb?.(this.position)
    }, 100)
  }

  private stopTicker() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null }
  }

  destroy() {
    this.stopTicker()
    this.howl?.unload()
    this.howl = null
  }
}
