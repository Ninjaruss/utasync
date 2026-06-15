import { SoundTouch, SimpleFilter, getWebAudioNode } from 'soundtouchjs'

export class SpeedControl {
  private context: AudioContext
  private st: SoundTouch
  private filter: SimpleFilter | null = null
  private node: AudioNode | null = null

  constructor(context: AudioContext) {
    this.context = context
    this.st = new SoundTouch(context.sampleRate)
    this.st.pitch = 1
  }

  setSpeed(speed: number) {
    this.st.tempo = speed
    this.st.pitch = 1 / speed
  }

  connectSource(source: AudioBufferSourceNode, buffer: AudioBuffer): AudioNode {
    this.filter = new SimpleFilter(buffer, this.st)
    this.node = getWebAudioNode(this.context, this.filter)
    source.connect(this.context.destination)
    return this.node
  }

  disconnect() {
    this.node?.disconnect()
    this.node = null
  }
}
