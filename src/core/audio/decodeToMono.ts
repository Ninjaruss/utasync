export interface MonoAudio {
  data: Float32Array
  sampleRate: number
}

function toMonoCopy(buffer: AudioBuffer): MonoAudio {
  const { numberOfChannels, length, sampleRate } = buffer
  const mono = new Float32Array(length)
  if (numberOfChannels === 1) {
    mono.set(buffer.getChannelData(0))
  } else {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channel = buffer.getChannelData(ch)
      for (let i = 0; i < length; i++) mono[i] += channel[i] / numberOfChannels
    }
  }
  return { data: mono, sampleRate }
}

function decodeErrorMessage(cause: unknown): string {
  const msg = cause instanceof Error ? cause.message : String(cause)
  if (/error in input stream|unable to decode|decoding failed|encodingerror/i.test(msg)) {
    return 'Could not decode this audio file. Try re-uploading the track (MP3, M4A, or WAV).'
  }
  return `Could not decode audio (${msg || 'unknown error'}). Try re-uploading the file.`
}

/** Decode a stored audio File to mono PCM suitable for Whisper / Demucs. */
export async function decodeAudioFileToMono(file: File): Promise<MonoAudio> {
  const raw = await file.arrayBuffer()
  // Some browsers detach the buffer passed to decodeAudioData — always copy.
  const copy = raw.slice(0)
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(copy)
    return toMonoCopy(decoded)
  } catch (cause) {
    throw new Error(decodeErrorMessage(cause), { cause })
  } finally {
    await ctx.close()
  }
}
