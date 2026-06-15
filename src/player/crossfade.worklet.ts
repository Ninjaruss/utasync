// Registered as 'crossfade-processor' via AudioWorklet.
// AudioWorkletProcessor / registerProcessor are worklet-scope globals not in
// the default TS DOM lib, so this line is intentionally untyped.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
class CrossfadeProcessor extends AudioWorkletProcessor {
  private fadeSamples = 0
  private totalFade = 0
  private fading = false

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0]
    const output = outputs[0]
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < output[ch].length; i++) {
        const gain = this.fading
          ? Math.max(0, 1 - this.fadeSamples / this.totalFade)
          : 1
        output[ch][i] = (input[ch]?.[i] ?? 0) * gain
        if (this.fading) this.fadeSamples++
      }
    }
    return true
  }
}
registerProcessor('crossfade-processor', CrossfadeProcessor)
