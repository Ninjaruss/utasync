import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WhisperTranscript } from '../../src/ai-pipeline/whisperTranscriber'
import { createSliceTranscriber } from '../../src/ai-pipeline/sliceTranscriber'

// The gap-slice re-transcriber is headless: it slices the shared audio buffer,
// runs it through the SAME crash-downgrade ladder AutoAlignFlow's main pass uses,
// and offsets the slice-relative words back to absolute song time. transcribeAudio
// is the only impure dependency, so it is mocked; sanitizeTranscript/chunksToWords
// run for real (a clean 1s "alpha" survives sanitize untouched).

const transcribeAudio = vi.fn(
  async (_audio: Float32Array, _rate: number, _opts?: {
    language?: string
    timestampMode?: 'word' | 'segment'
    highAccuracy?: boolean
  }): Promise<WhisperTranscript> => ({ text: '', chunks: [] }),
)

vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: Parameters<typeof transcribeAudio>) => transcribeAudio(...args),
}))

// A recognizable ramp so the sliced window is observable: sample i has value i.
function ramp(n: number): Float32Array {
  const d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = i
  return d
}

const baseDeps = () => ({
  audioData: ramp(2000),
  sampleRate: 100,
  isCancelled: () => false,
  highAccuracy: false,
  timestampMode: 'segment' as const,
})

beforeEach(() => {
  transcribeAudio.mockReset()
  transcribeAudio.mockResolvedValue({ text: '', chunks: [] })
})

describe('createSliceTranscriber', () => {
  it('slices audioData to [floor(t0*sr), floor(t1*sr)] and forwards language + modes', async () => {
    const tx = createSliceTranscriber(baseDeps())
    await tx.transcribe(3, 5, 'en')

    expect(transcribeAudio).toHaveBeenCalledTimes(1)
    const [buf, rate, opts] = transcribeAudio.mock.calls[0]
    // Window opens at ramp sample floor(3 * 100) = 300 (value 300 proves the offset).
    expect(buf[0]).toBe(300)
    expect(buf.length).toBe(200) // floor(5*100) - floor(3*100)
    expect(rate).toBe(100)
    expect(opts?.language).toBe('en')
    expect(opts?.timestampMode).toBe('segment')
    expect(opts?.highAccuracy).toBe(false)
  })

  it('offsets returned word times by +t0 (slice-relative → absolute song time)', async () => {
    transcribeAudio.mockResolvedValue({ text: '', chunks: [{ text: 'alpha', timestamp: [1, 2] }] })
    const tx = createSliceTranscriber(baseDeps())

    const words = await tx.transcribe(3, 5, 'en')
    expect(words).toEqual([{ word: 'alpha', startTime: 4, endTime: 5 }])
  })

  it('downgrades word→segment timestamps on a recoverable crash and retries once', async () => {
    transcribeAudio
      .mockRejectedValueOnce(new Error('The on-device model crashed (WASM error 1261431424) — out of memory'))
      .mockResolvedValueOnce({ text: '', chunks: [{ text: 'x', timestamp: [0, 1] }] })
    const tx = createSliceTranscriber({ ...baseDeps(), timestampMode: 'word' })

    const words = await tx.transcribe(0, 5, 'ja')
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    expect(transcribeAudio.mock.calls[0][2]?.timestampMode).toBe('word')
    expect(transcribeAudio.mock.calls[1][2]?.timestampMode).toBe('segment')
    expect(words).toEqual([{ word: 'x', startTime: 0, endTime: 1 }])
  })

  it('downgrades high-accuracy → standard model when already in segment mode', async () => {
    transcribeAudio
      .mockRejectedValueOnce(new Error('crashed 999'))
      .mockResolvedValueOnce({ text: '', chunks: [] })
    const tx = createSliceTranscriber({ ...baseDeps(), highAccuracy: true, timestampMode: 'segment' })

    await tx.transcribe(0, 5, 'ja')
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    expect(transcribeAudio.mock.calls[0][2]?.highAccuracy).toBe(true)
    expect(transcribeAudio.mock.calls[1][2]?.highAccuracy).toBe(false)
  })

  it('does not retry a user cancellation', async () => {
    transcribeAudio.mockRejectedValueOnce(new Error('Transcription cancelled'))
    const tx = createSliceTranscriber({ ...baseDeps(), timestampMode: 'word' })

    await expect(tx.transcribe(0, 5, 'ja')).rejects.toThrow(/cancel/i)
    expect(transcribeAudio).toHaveBeenCalledTimes(1)
  })

  it('re-throws (no retry) once the ladder is exhausted — segment + standard already', async () => {
    transcribeAudio.mockRejectedValue(new Error('crashed 111'))
    const tx = createSliceTranscriber({ ...baseDeps(), highAccuracy: false, timestampMode: 'segment' })

    await expect(tx.transcribe(0, 5, 'ja')).rejects.toThrow(/crashed/i)
    expect(transcribeAudio).toHaveBeenCalledTimes(1)
  })

  it('a slice-triggered downgrade sticks for later slices (own ladder state)', async () => {
    transcribeAudio
      .mockRejectedValueOnce(new Error('oom crash'))
      .mockResolvedValue({ text: '', chunks: [] })
    const tx = createSliceTranscriber({ ...baseDeps(), timestampMode: 'word' })

    await tx.transcribe(0, 3, 'ja') // word fails → downgrade to segment → retry
    await tx.transcribe(3, 6, 'ja') // second slice must already start in segment mode

    expect(transcribeAudio).toHaveBeenCalledTimes(3)
    expect(transcribeAudio.mock.calls[2][2]?.timestampMode).toBe('segment')
  })
})
