import { describe, it, expect } from 'vitest'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

interface W {
  word: string
  startTime: number
  endTime: number
}

/** One transcript word per JA glyph at ~0.35s each, starting at `start`. */
function jaWords(text: string, start: number, perChar = 0.35): W[] {
  return [...text].map((word, i) => ({
    word,
    startTime: +(start + i * perChar).toFixed(3),
    endTime: +(start + (i + 1) * perChar).toFixed(3),
  }))
}

function enWords(pairs: [string, number, number][]): W[] {
  return pairs.map(([word, s, e]) => ({ word, startTime: s, endTime: e }))
}

function refine(lyrics: string[], words: W[]) {
  const sheetRows = lyrics.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  return refineAlignmentWithPhrases(sheetRows, words, 'ja')
}

// Task 7 / C2b — phonetic anchor recovery for misheard sung English lines.
// These are SYNTHETIC end-to-end scenarios (the real stranger-than-heaven
// candidate is blocked by a separate class-B mis-anchoring of its neighbour, so
// it cannot demonstrate the tuner in isolation). "Broken city lights" misheard
// as "Prakkun zaydee loyss" fails the lexical LCS (quality needs_review) but
// keeps its consonant frame (phonetic similarity 0.889 >= the 0.70 floor).
describe('phonetic anchor recovery (integration)', () => {
  it('re-anchors a misheard English line onto its true (misheard) sung span', () => {
    const lyrics = ['君の声が聞こえる', 'Broken city lights', '夜が明ける前に', '静かに歩いて']
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0), // anchors 'good' ~10.0-12.8
      // misheard "Broken city lights" -> "Prakkun zaydee loyss" @ 20.0-22.0,
      // sitting in the gap between the JA anchors with room on both sides so the
      // ownership guard does not trip.
      ...enWords([
        ['Prakkun', 20.0, 20.6],
        ['zaydee', 20.6, 21.2],
        ['loyss', 21.2, 22.0],
      ]),
      ...jaWords('夜が明ける前に', 25.0),
      ...jaWords('静かに歩いて', 29.0),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[1]
    // Without phonetic recovery this line is interpolated across the dead air
    // (roughly 14.5-23.5, far off the real span). Recovery pins it to 20.0-22.0.
    expect(line.startTime).toBeGreaterThan(19.5)
    expect(line.startTime).toBeLessThan(20.5)
    expect(line.endTime).toBeGreaterThan(21.5)
    expect(line.endTime).toBeLessThan(22.5)
    // A recovered line sits on real (misheard) audio — upgraded off needs_review.
    expect(refined.lineAlignmentQuality[1]).not.toBe('needs_review')
  })

  it('does NOT re-anchor an English line with no phonetic match (threshold gate holds)', () => {
    const lyrics = ['君の声が聞こえる', 'Broken city lights', '夜が明ける前に', '静かに歩いて']
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0),
      // Unrelated JA activity fills the 20-22 gap — no English phonetic match.
      ...jaWords('全然違う言葉', 20.0),
      ...jaWords('夜が明ける前に', 25.0),
      ...jaWords('静かに歩いて', 29.0),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[1]
    // The tuner must not false-anchor the English line onto the unrelated JA
    // span at 20.0; it stays where the lexical pipeline left it (~14.5) and
    // remains flagged (no spurious upgrade).
    expect(line.startTime).toBeLessThan(19.0)
    expect(refined.lineAlignmentQuality[1]).toBe('needs_review')
  })

  // Ownership guard — protects a legitimately-anchored previous line. The
  // previous line matches the transcript verbatim (a real 'good' lexical span),
  // and the misheard English line's phonetic anchor overlaps that span, so
  // recovering onto it would pull the previous line's end back and compress it
  // below its floor. The guard must decline the recovery.
  it('does NOT recover when doing so would compress a previous line with a real matched span', () => {
    const lyrics = ['君の声が聞こえる', '夜の街を歩く', 'Broken city lights', '朝が来る']
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0), // ends ~12.8
      ...jaWords('夜の街を歩く', 18.0), // 18.0-20.1 verbatim -> 'good', ~2.1s span
      // misheard "Broken city lights" -> "Prakkun zaydee loyss" starting INSIDE
      // the previous line's span (19.0), so recovery there would compress it.
      ...enWords([
        ['Prakkun', 19.0, 19.6],
        ['zaydee', 19.6, 20.2],
        ['loyss', 20.2, 21.0],
      ]),
      ...jaWords('朝が来る', 25.0),
    ]

    const refined = refine(lyrics, words)
    // Previous line keeps its full matched span (not clipped to a sliver).
    const prev = refined.lines[1]
    expect(prev.startTime).toBeCloseTo(18.0, 1)
    expect(prev.endTime - prev.startTime).toBeGreaterThan(1.5)
    // English line was NOT re-anchored onto 19-21; it stays flagged.
    const line = refined.lines[2]
    expect(line.startTime).toBeGreaterThan(20.5)
    expect(refined.lineAlignmentQuality[2]).toBe('needs_review')
  })

  // Ownership guard — must NOT over-block. When the previous line has NO
  // reliable lexical span (here it is untranscribed — no matching words), it has
  // no evidence-based claim to the disputed region and must not block this
  // recovery. (Pre-fix, the -Infinity span fallback made the compression check
  // unconditionally skip recovery here — the reviewer's reproduced bug.) The
  // downstream redistribution pass re-times the unanchored previous line.
  it('recovers even when the previous line lacks a lexical span (guard does not over-block)', () => {
    // Enough verbatim JA material to stay in content mode (the tuner is gated
    // off in the proportional fallback).
    const lyrics = [
      '君の声が聞こえる',
      '遠くの空を見上げて',
      'Silent gap nothing here',
      'Broken city lights',
      '夜が明ける前に',
      '静かに歩いて行こう',
    ]
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 10.0), // ends ~12.8
      ...jaWords('遠くの空を見上げて', 13.5), // ends ~16.7
      // NO words for "Silent gap nothing here" — it is untranscribed, so it has
      // no reliable lexical matched span.
      // misheard "Broken city lights" -> "Prakkun zaydee loyss" in a clean gap.
      ...enWords([
        ['Prakkun', 20.0, 20.6],
        ['zaydee', 20.6, 21.2],
        ['loyss', 21.2, 22.0],
      ]),
      ...jaWords('夜が明ける前に', 25.0),
      ...jaWords('静かに歩いて行こう', 28.5),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[3]
    // The English line is recovered onto its phonetic span despite the
    // spanless previous line.
    expect(line.startTime).toBeGreaterThan(19.5)
    expect(line.startTime).toBeLessThan(20.5)
    expect(line.endTime).toBeGreaterThan(21.5)
    expect(line.endTime).toBeLessThan(22.5)
    expect(refined.lineAlignmentQuality[3]).not.toBe('needs_review')
  })

  // Redistribution interaction — a recovered line is lexically needs_review,
  // so redistributeDegenerateRuns would see it as unanchored; when its
  // neighbouring run is degenerate (garbled lines piled into a tiny window),
  // the whole run gets re-timed and the phonetic anchor is destroyed (line
  // dragged off its evidenced audio). The recovered mask is passed to
  // redistribution as anchors so runs break AROUND recovered lines.
  it('a recovered line anchors the redistribution run instead of being re-timed by it', () => {
    // Enough verbatim JA material to stay in content mode (the tuner is gated
    // off in the proportional fallback).
    const lyrics = [
      '君の声が聞こえる',
      '遠くの空を見上げて',
      '風の音が響いてる',
      '街の灯りが揺れている',
      'Endless whispers in the void',
      'Shadows crawling on the wall',
      'Voices echo in the hall',
      'Whispers fading into night',
      'Broken city lights', // misheard @ 23-25 -> phonetic recovery
      '夜が明ける前に',
      '静かに歩いて行こう',
      '朝の光が差し込んで',
      '新しい一日が始まる',
    ]
    const words: W[] = [
      ...jaWords('君の声が聞こえる', 2.0),
      ...jaWords('遠くの空を見上げて', 5.0),
      ...jaWords('風の音が響いてる', 8.5),
      ...jaWords('街の灯りが揺れている', 11.5), // ends ~15.0
      ...enWords([
        // Garble for the four unmatched lines (degenerate run), 16-18.5:
        ['mumble', 16.0, 16.5],
        ['garble', 16.5, 17.0],
        ['hums', 17.0, 17.4],
        ['drone', 17.4, 17.8],
        ['buzz', 17.8, 18.1],
        ['whirr', 18.1, 18.5],
        // misheard "Broken city lights" -> "Prakkun zaydee loyss":
        ['Prakkun', 23.0, 23.6],
        ['zaydee', 23.6, 24.2],
        ['loyss', 24.2, 25.0],
      ]),
      ...jaWords('夜が明ける前に', 26.0),
      ...jaWords('静かに歩いて行こう', 29.5),
      ...jaWords('朝の光が差し込んで', 33.0),
      ...jaWords('新しい一日が始まる', 36.5),
    ]

    const refined = refine(lyrics, words)
    const line = refined.lines[8]
    // Without the anchor mask, redistribution re-times the degenerate run
    // [4..8] across ALL its activity — packing garbled lines onto the 23-25
    // anchor audio and squeezing this line to a 0.16s sliver at 24.84-25.00
    // (yet still upgrading it via the stale mask, the second defect). With
    // the mask, the line stays pinned on its phonetic span and the garbled
    // run packs into the 16-18.5 region instead.
    expect(line.startTime).toBeGreaterThan(22.5)
    expect(line.startTime).toBeLessThan(23.3)
    expect(line.endTime).toBeGreaterThan(24.7)
    expect(line.endTime).toBeLessThan(25.3)
    expect(refined.lineAlignmentQuality[8]).not.toBe('needs_review')
  })
})
