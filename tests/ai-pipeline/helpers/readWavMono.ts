import { readFileSync } from 'node:fs'

/** Read a standard PCM WAV file into mono float32 samples (for Whisper tests). */
export function readWavMono(filePath: string): { data: Float32Array; sampleRate: number } {
  const buf = readFileSync(filePath)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const sampleRate = view.getUint32(24, true)
  let dataOffset = 44
  for (let i = 12; i + 8 < buf.length; ) {
    const id = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3])
    const size = view.getUint32(i + 4, true)
    if (id === 'data') {
      dataOffset = i + 8
      break
    }
    i += 8 + size
  }
  const samples = (buf.length - dataOffset) / 2
  const data = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    data[i] = view.getInt16(dataOffset + i * 2, true) / 32768
  }
  return { data, sampleRate }
}
