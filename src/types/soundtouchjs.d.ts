declare module 'soundtouchjs' {
  export class SoundTouch {
    constructor(sampleRate: number)
    tempo: number
    pitch: number
  }
  export class SimpleFilter {
    constructor(buffer: AudioBuffer, soundTouch: SoundTouch)
  }
  export function getWebAudioNode(context: AudioContext, filter: SimpleFilter): AudioNode
}
