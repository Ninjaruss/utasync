import { describe, it, expect } from 'vitest'
import { redistributeDegenerateRuns } from '../../src/lyrics/redistributeDegenerateRuns'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })

function anchorWords(text: string, start: number, end: number) {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

// Round-7 run-coverage lexical gate (user report: on "Rockn Roll Morning Light
// Falls On You" a whole verse was placed on an instrumental ~4:15–4:28).
// findActivityRegions treats ANY Whisper word as activity, so a hallucinated
// blip during an instrumental forms a false region that attracts the whole run.
// The gate rejects an activity region whose words lexically corroborate
// near-zero of the RUN's expected text, so the run spreads honestly instead.
describe('redistributeDegenerateRuns — run-coverage lexical gate', () => {
  const before = 'the quick brown fox jumps over the lazy dog again'
  const after = 'every good boy deserves fudge and cake at the party'
  const runLine = (i: number) => `moonlight velvet harbor drifting slowly ${i}`

  it('does NOT pack a run onto an instrumental-noise region that fails to match it', () => {
    // The only activity inside the [14,44] window is a lone ~1s hallucinated
    // blip (mirrors the AKFG `ような`): one word that shares no reliable run of
    // matched chars with the run's lyric lines (run-coverage ≈ 0) and carries
    // too little audio to be real vocals. The old packer clustered the whole
    // verse onto it and even upgraded lines to approximate; the gate rejects it
    // on both the lexical and the density clause.
    const words = [
      ...anchorWords(before, 10, 14),
      w('zzqx', 26, 27),
      ...anchorWords(after, 44, 48),
    ]
    const lines = [
      line(before, 10, 14),
      ...Array.from({ length: 3 }, (_, i) => line(runLine(i), 14 + i * 0.1, 14.1 + i * 0.1)),
      line(after, 44, 48),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    // Still re-timed (the run was degenerate) — but not onto the blip.
    expect(res.redistributed.slice(1, 4)).toEqual([true, true, true])
    // A rejected region leaves the fail-safe: spread across the whole window at
    // floor, off-activity — an honest needs_review, never a false approximate.
    expect(res.onActivity.slice(1, 4)).toEqual([false, false, false])
    // The first run line starts near the window start (~14), not jumping to the
    // 26s blip the old code clustered on.
    expect(res.lines[1].startTime).toBeLessThan(20)
    // The run occupies far more than the blip's 2s span — spread, not clustered.
    expect(res.lines[3].endTime - res.lines[1].startTime).toBeGreaterThan(6)
    // Anchors untouched.
    expect(res.lines[0]).toMatchObject({ startTime: 10, endTime: 14 })
    expect(res.lines[4]).toMatchObject({ startTime: 44, endTime: 48 })
  })

  it('still packs a run onto a real region whose words DO match it (gate is selective)', () => {
    // Same shape, but the mid-window [26,40] region is the run's own text —
    // real vocals Whisper caught (run-coverage well above threshold). The gate
    // keeps it and redistribution clusters the run there, exactly as before the
    // gate — the fix must not break healthy redistribution.
    const real = 'moonlight velvet harbor drifting slowly moonlight velvet harbor'
    const words = [
      ...anchorWords(before, 10, 14),
      ...anchorWords(real, 26, 40),
      ...anchorWords(after, 44, 48),
    ]
    const lines = [
      line(before, 10, 14),
      ...Array.from({ length: 4 }, (_, i) => line(runLine(i), 14 + i * 0.1, 14.1 + i * 0.1)),
      line(after, 44, 48),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 5)).toEqual([true, true, true, true])
    // The run is clustered onto the matched region starting ~26, NOT spread
    // from the window start (~14) the way a rejected region would force.
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(26 - 1e-6)
    expect(res.lines[4].endTime).toBeLessThanOrEqual(44)
    // Sitting on corroborated activity at meaningful width — eligible for the
    // approximate upgrade.
    expect(res.onActivity.slice(1, 5)).toEqual([true, true, true, true])
    expect(res.lines[0]).toMatchObject({ startTime: 10, endTime: 14 })
    expect(res.lines[5]).toMatchObject({ startTime: 44, endTime: 48 })
  })
})
