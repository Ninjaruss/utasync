import { AutoModelForCTC, AutoProcessor } from '@huggingface/transformers'
import { forcedAlignCTC } from './viterbi'
import { lineToTokenIds, lineToTokenIdsJa } from './normalize'

const CTC_MODEL = 'Xenova/wav2vec2-base-960h'
// Vocab from the Task 1 spike (config.id2label is null on this model).
export const LABEL2ID: Record<string, number> = {
  '<pad>': 0, '<s>': 1, '</s>': 2, '<unk>': 3, '|': 4, E: 5, T: 6, A: 7, O: 8, N: 9, I: 10,
  H: 11, S: 12, R: 13, D: 14, L: 15, U: 16, M: 17, W: 18, C: 19, F: 20, G: 21, Y: 22, P: 23,
  B: 24, V: 25, K: 26, "'": 27, X: 28, J: 29, Q: 30, Z: 31,
}
const BLANK_ID = 0
const WORD_SEP = '|'
// If a single whole-song forward pass fails (OOM/hang), the audio is processed
// in chunks of this many 16kHz samples (~30s) and emissions are concatenated.
const CHUNK_SAMPLES = 480000

export interface ForcedLineTiming { start: number; end: number; score: number }
export interface ForceAlignInput { text: string; lang: 'ja' | 'en' }

let processorP: Promise<unknown> | null = null
let modelP: Promise<unknown> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logitsToEmissions(out: any, into: number[][]): void {
  const dims: number[] = out.logits.dims // [1, T, V]
  const T = dims[1], V = dims[2]
  const flat: Float32Array = out.logits.data
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(V)
    let max = -Infinity
    for (let v = 0; v < V; v++) { const x = flat[t * V + v]; row[v] = x; if (x > max) max = x }
    let sum = 0
    for (let v = 0; v < V; v++) { const e = Math.exp(row[v] - max); row[v] = e; sum += e }
    for (let v = 0; v < V; v++) row[v] = Math.log(row[v] / sum)
    into.push(row)
  }
}

export async function forceAlignLines(
  audio16k: Float32Array, // MUST be 16kHz mono
  sampleRate: number,
  lines: ForceAlignInput[],
  deps: { romanize: (t: string) => Promise<string> },
): Promise<{ lineTimings: ForcedLineTiming[] }> {
  if (sampleRate !== 16000) throw new Error(`forceAlignLines expects 16kHz, got ${sampleRate}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processor: any = await (processorP ??= AutoProcessor.from_pretrained(CTC_MODEL) as Promise<unknown>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = await (modelP ??= AutoModelForCTC.from_pretrained(CTC_MODEL) as Promise<unknown>)

  const emissions: number[][] = []
  if (audio16k.length <= CHUNK_SAMPLES) {
    const inputs = await processor(audio16k)
    const out = await model(inputs)
    logitsToEmissions(out, emissions)
  } else {
    // Whole-song self-attention is O(frames^2) — for a full song (~10k frames)
    // it hangs rather than erroring, so chunk PROACTIVELY (not just on a thrown
    // OOM). ~30s chunks, concatenating per-chunk emission rows; frames are
    // contiguous across chunks so a plain append preserves the time axis.
    for (let off = 0; off < audio16k.length; off += CHUNK_SAMPLES) {
      const chunk = audio16k.subarray(off, Math.min(off + CHUNK_SAMPLES, audio16k.length))
      const inputs = await processor(chunk)
      const out = await model(inputs)
      logitsToEmissions(out, emissions)
    }
  }
  const T = emissions.length

  const lineRanges: { startTok: number; endTok: number }[] = []
  const tokens: number[] = []
  for (const line of lines) {
    const ids = line.lang === 'ja'
      ? await lineToTokenIdsJa(line.text, LABEL2ID, { wordSep: WORD_SEP, romanize: deps.romanize })
      : lineToTokenIds(line.text, 'en', LABEL2ID, { wordSep: WORD_SEP })
    const startTok = tokens.length
    tokens.push(...ids)
    lineRanges.push({ startTok, endTok: tokens.length })
    tokens.push(LABEL2ID[WORD_SEP]) // line boundary
  }

  const spans = forcedAlignCTC(emissions, tokens, BLANK_ID)
  const secPerFrame = (audio16k.length / 16000) / T
  const lineTimings: ForcedLineTiming[] = lineRanges.map(({ startTok, endTok }) => {
    const inLine = spans.filter((s) => s.tokenIndex >= startTok && s.tokenIndex < endTok)
    if (inLine.length === 0) return { start: 0, end: 0, score: 0 }
    const start = inLine[0].startFrame * secPerFrame
    const end = (inLine[inLine.length - 1].endFrame + 1) * secPerFrame
    return { start, end, score: inLine.length / Math.max(1, endTok - startTok) }
  })
  return { lineTimings }
}
