import { describe, it, expect } from 'vitest'
import { anchorLeadingEdge } from '../../src/lyrics/leadingEdgeAnchor'
import { firstVocalOnset, type VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * Field case — Asian Kung-Fu Generation, "Rock'n'Roll, Morning Light Falls on
 * You" (THE FIRST TAKE), measured live in Firefox on the real 6:33 recording:
 * app path (WebGPU vocal isolation ON, word timestamps) scored mean|err| 16.7s
 * with **line #0 placed at 31.35s** when the singing actually starts at 98s
 * (official captions). 31.35s is EXACTLY the value the stem's envelope reported
 * as `firstVocalOnset`: on a live acoustic performance the separated "vocals"
 * stem retains enough guitar/reverb bleed for a sustained voiced run to pass
 * firstVocalOnset's dip gate, and `anchorLeadingEdge`'s late branch then pulled a
 * weakly-matched opening 66 seconds forward onto it.
 *
 * The pull itself is deliberate (an opening interpolated onto a long intro SHOULD
 * move to where singing starts). What was missing is any corroboration that the
 * onset is speech: the transcription of that same stem had no words there.
 */

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

const word = (text: string, startTime: number, endTime: number): TranscriptWord => ({
  word: text,
  startTime,
  endTime,
})

/** Envelope for the real recording: bleed at ~31s, real singing from 98s. */
function akfgEnvelope(): VocalActivitySignal {
  const hopSec = 0.05
  const frames = Math.ceil(400 / hopSec)
  const activity = new Float32Array(frames)
  const voiced = (from: number, to: number, level: number) => {
    for (let f = Math.floor(from / hopSec); f < Math.min(frames, Math.ceil(to / hopSec)); f++) {
      activity[f] = level
    }
  }
  voiced(31.35, 44, 0.5) // guitar/reverb bleed on the stem
  voiced(98, 320, 0.7) // the actual vocal
  return { hopSec, activity, onset: new Float32Array(frames), source: 'stem' }
}

describe('anchorLeadingEdge — corroborating a false vocal onset', () => {
  const sig = akfgEnvelope()

  it('the stem envelope really does report the false onset (31.35s, not 98s)', () => {
    const onset = firstVocalOnset(sig)
    expect(onset).not.toBeNull()
    expect(onset!).toBeGreaterThan(30)
    expect(onset!).toBeLessThan(33)
  })

  it('does not pull an opening onto an onset the transcript does not corroborate', () => {
    // The sheet's opening lines sit where the aligner put them on a stem whose
    // transcription matched them poorly (the live case: 0/30 lines scored 'good').
    const lines = [
      line('出来れば世界を僕は塗り変えたい', 96.5, 99),
      line('戦争をなくすような大逸れたことじゃない', 103, 106),
      line('だけどちょっと それもあるよな', 110, 112),
      line('俳優や映画スターには成れない', 116, 118),
      line('岩は転がって 僕たちを何処かに連れて行くように ように', 200, 205),
    ]
    // The transcription of the stem: no words anywhere near 31s; the later
    // content-matched line is the only strong evidence.
    const words = [
      word('それどころか', 119, 120.5),
      word('岩は転がって', 200.5, 202),
      word('僕たちを', 202, 203.5),
      word('何処かに', 203.5, 204.5),
      word('連れて行くように', 204.5, 206),
    ]
    const spans = computeLineMatchedSpans(
      lines.map((l) => l.original),
      words,
    )
    // What the flow actually saw: the opening rows matched the stem's transcript
    // too weakly to be trusted, while the later row matched well.
    expect(spans[0]?.matchedChars ?? 0).toBe(0)
    expect((spans[4]!.matchedChars / spans[4]!.totalChars)).toBeGreaterThan(0.5)

    const out = anchorLeadingEdge(lines, 31.35, 'ja', { spans, transcriptWords: words })

    // The whole point: the opening must stay where the content put it, ~66s later
    // than the uncorroborated onset.
    expect(out[0].startTime).toBeCloseTo(96.5, 1)
    expect(Math.abs(out[0].startTime - 31.35)).toBeGreaterThan(50)
  })

  it('still moves the opening forward when the onset IS corroborated by speech', () => {
    // Same envelope and geometry, but this time the transcription DID emit words
    // at the onset — even though they do not match this opening row's text (a
    // misheard opening phrase is exactly why the row would be weakly matched).
    // Speech there is what makes the acoustic entry credible.
    const lines = [
      line('あの丘を越えたその先は', 40, 42),
      line('君の孤独も全て暴き出す朝だ', 44, 46),
      line('岩は転がって 僕たちを何処かに連れて行くように ように', 200, 205),
    ]
    const words = [
      word('ラララ', 31.5, 32.5),
      word('オー', 32.5, 33.5),
      word('岩は転がって', 200.5, 202),
      word('僕たちを', 202, 203.5),
      word('何処かに', 203.5, 204.5),
      word('連れて行くように', 204.5, 206),
    ]
    const spans = computeLineMatchedSpans(
      lines.map((l) => l.original),
      words,
    )
    expect(spans[0]?.matchedChars ?? 0).toBe(0) // opening row unmatched, so eligible
    const out = anchorLeadingEdge(lines, 31.35, 'ja', { spans, transcriptWords: words })
    expect(out[0].startTime).toBeGreaterThanOrEqual(31.3)
    expect(out[0].startTime).toBeLessThan(40)
  })
})
