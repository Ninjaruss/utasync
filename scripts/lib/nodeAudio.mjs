/**
 * Decode an mp3 file to mono Float32 PCM in Node, mirroring
 * src/core/audio/decodeToMono.ts (which uses the browser's AudioContext —
 * unavailable here). Used by auto-align audit scripts.
 */
import { readFileSync } from 'node:fs'
import { MPEGDecoder } from 'mpg123-decoder'

export async function decodeMp3ToMono(path) {
  const decoder = new MPEGDecoder()
  await decoder.ready
  const buf = new Uint8Array(readFileSync(path))
  const { channelData, sampleRate } = decoder.decode(buf)
  decoder.free()

  const length = channelData[0].length
  const mono = new Float32Array(length)
  if (channelData.length === 1) {
    mono.set(channelData[0])
  } else {
    for (let ch = 0; ch < channelData.length; ch++) {
      const channel = channelData[ch]
      for (let i = 0; i < length; i++) mono[i] += channel[i] / channelData.length
    }
  }
  return { data: mono, sampleRate }
}
