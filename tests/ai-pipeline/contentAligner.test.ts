import { describe, it, expect } from 'vitest'
import { normalizeForMatch, alignByContent } from '../../src/ai-pipeline/contentAligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('normalizeForMatch', () => {
  it('keeps lowercase latin and Japanese, drops spaces/punctuation', () => {
    expect(normalizeForMatch('You always make me')).toBe('youalwaysmakeme')
    expect(normalizeForMatch('「どうした？」なんて')).toBe('どうしたなんて')
    expect(normalizeForMatch('I promise, for my eyes only!')).toBe('ipromiseformyeyesonly')
  })

  it('normalizes the katakana stylization キミ to 君 so it matches Whisper\'s kanji output', () => {
    expect(normalizeForMatch('キミの隣で')).toBe(normalizeForMatch('君の隣で'))
  })
})

describe('alignByContent (exact match)', () => {
  it('anchors each line to the real timestamp of its matched words', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あ', startTime: 1, endTime: 1.4 },
      { word: 'お', startTime: 1.4, endTime: 1.8 },
      { word: 'ぞ', startTime: 1.8, endTime: 2.2 },
      { word: 'ら', startTime: 2.2, endTime: 2.6 },
      { word: 'ゆ', startTime: 10, endTime: 10.4 },
      { word: 'き', startTime: 10.4, endTime: 10.8 },
      { word: 'が', startTime: 10.8, endTime: 11.2 },
      { word: 'ふ', startTime: 11.2, endTime: 11.6 },
      { word: 'る', startTime: 11.6, endTime: 12 },
    ]
    const { lines: out, confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(1)
    expect(out[0].startTime).toBeLessThan(2)
    expect(out[1].startTime).toBeGreaterThanOrEqual(10)
    expect(out[1].startTime).toBeLessThan(11)
    expect(confidence).toBeGreaterThan(0.9)
  })

  it('reports low confidence when nothing matches', () => {
    const lines = ['あおぞら']
    const words: TranscriptWord[] = [{ word: 'zzz', startTime: 1, endTime: 2 }]
    const { confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(confidence).toBeLessThan(0.2)
  })
})

describe('alignByContent (katakana pronoun stylization)', () => {
  it('anchors a line using キミ to the real timestamp of Whisper\'s 君 transcription', () => {
    // Lyric sheets commonly stylize 君 ("you") as the katakana キミ, but Whisper's
    // Japanese ASR normally outputs the canonical kanji 君. Pre-fix, the literal
    // character mismatch (キ/ミ vs 君) meant a line like this had no reliable
    // anchor at all and fell back to interpolation, even though it's clearly sung.
    const lines = ['キミの隣で']
    const words: TranscriptWord[] = [
      { word: '君', startTime: 12, endTime: 12.3 },
      { word: 'の', startTime: 12.3, endTime: 12.6 },
      { word: '隣', startTime: 12.6, endTime: 13.0 },
      { word: 'で', startTime: 13.0, endTime: 13.3 },
    ]
    const { lines: out, confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(12)
    expect(out[0].startTime).toBeLessThan(13)
    expect(confidence).toBeGreaterThan(0.5)
  })
})

describe('alignByContent (spurious single-char matches)', () => {
  it('does not anchor a line to an isolated single-character coincidence', () => {
    // Line 1 is a single common particle with nothing else around it in the
    // lyric — any match for it is, by definition, a 1-character coincidence,
    // not real evidence of where it's sung. Line 2's real words appear later,
    // together, at 30s. Pre-fix, anchorsByLine took *any* matched char as the
    // line's anchor, so line 1 would pin to wherever 'は' happened to LCS-match
    // (here, the earliest occurrence at 2s) — implying the line starts playing
    // during unrelated audio. It should instead have no reliable anchor and
    // fall back to interpolation (0, since it's the leading unanchored line).
    const lines = ['は', 'ねこ']
    const words: TranscriptWord[] = [
      { word: 'は', startTime: 2, endTime: 2.4 }, // coincidental, not line 1's real audio
      { word: 'ねこ', startTime: 30, endTime: 30.8 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBe(0)
    expect(out[1].startTime).toBeGreaterThanOrEqual(30)
  })

  it('still anchors a short line when its match is a contiguous multi-char run', () => {
    const lines = ['は', 'ねこは']
    const words: TranscriptWord[] = [
      { word: 'は', startTime: 2, endTime: 2.4 }, // coincidental, ignored
      { word: 'ねこ', startTime: 30, endTime: 30.8 },
      { word: 'は', startTime: 30.8, endTime: 31.2 }, // contiguous with 'ねこ' above — real run
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[1].startTime).toBeGreaterThanOrEqual(30)
  })
})

describe('alignByContent (repeated lines)', () => {
  it('does not place a later repeated line earlier than a previous line', () => {
    // "ねえ" appears 3 times; the transcript has them at 5s, 50s, 90s.
    const lines = ['ねえ', 'そら', 'ねえ', 'うみ', 'ねえ']
    const words: TranscriptWord[] = [
      { word: 'ねえ', startTime: 5, endTime: 6 },
      { word: 'そら', startTime: 20, endTime: 21 },
      { word: 'ねえ', startTime: 50, endTime: 51 },
      { word: 'うみ', startTime: 70, endTime: 71 },
      { word: 'ねえ', startTime: 90, endTime: 91 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
    expect(out[4].startTime).toBeGreaterThan(out[3].startTime)
  })
})

describe('alignByContent (interjections and repetition)', () => {
  it('does not anchor sigh rows like 嗚呼 to unrelated transcript tokens', () => {
    const lines = ['何を間違った', '嗚呼...', 'ローリング ローリング']
    const words: TranscriptWord[] = [
      { word: '何', startTime: 40, endTime: 40.3 },
      { word: 'を', startTime: 40.3, endTime: 40.5 },
      { word: '間違', startTime: 40.5, endTime: 41 },
      { word: 'った', startTime: 41, endTime: 41.3 },
      { word: 'ローリング', startTime: 55, endTime: 55.8 },
      { word: 'ローリング', startTime: 56, endTime: 56.8 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(40)
    expect(out[2].startTime).toBeGreaterThanOrEqual(55)
    expect(out[1].startTime).toBeGreaterThanOrEqual(out[0].startTime)
    expect(out[1].startTime).toBeLessThan(out[2].startTime)
  })

  it('places both ローリング chorus lines at their later occurrences', () => {
    const lines = ['verse', 'ローリング ローリング', 'bridge', 'ローリング ローリング']
    const words: TranscriptWord[] = [
      { word: 'verse', startTime: 10, endTime: 11 },
      { word: 'ローリング', startTime: 50, endTime: 50.8 },
      { word: 'ローリング', startTime: 51, endTime: 51.8 },
      { word: 'bridge', startTime: 70, endTime: 71 },
      { word: 'ローリング', startTime: 120, endTime: 120.8 },
      { word: 'ローリング', startTime: 121, endTime: 121.8 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[1].startTime).toBeGreaterThanOrEqual(50)
    expect(out[3].startTime).toBeGreaterThanOrEqual(120)
    expect(out[3].startTime).toBeGreaterThan(out[2].startTime)
  })
})

describe('alignByContent (line boundary bleed)', () => {
  it('does not move 心絡まって early when Whisper drops この先も from the prior line', () => {
    const lines = ['僕らはきっとこの先も', '心絡まって ローリング ローリング']
    const words: TranscriptWord[] = [
      { word: '僕', startTime: 100, endTime: 100.15 },
      { word: 'ら', startTime: 100.15, endTime: 100.3 },
      { word: 'は', startTime: 100.3, endTime: 100.45 },
      { word: 'き', startTime: 100.45, endTime: 100.6 },
      { word: 'っ', startTime: 100.6, endTime: 100.75 },
      { word: 'と', startTime: 100.75, endTime: 100.9 },
      { word: '心', startTime: 102.2, endTime: 102.4 },
      { word: '絡', startTime: 102.4, endTime: 102.6 },
      { word: 'ま', startTime: 102.6, endTime: 102.75 },
      { word: 'って', startTime: 102.75, endTime: 103 },
      { word: 'ローリング', startTime: 103, endTime: 103.8 },
      { word: 'ローリング', startTime: 103.8, endTime: 104.6 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(100)
    expect(out[0].startTime).toBeLessThan(101)
    // Line 2 must not start at と's timestamp — この先も still needs time on line 1.
    expect(out[1].startTime).toBeGreaterThan(101.5)
    expect(out[1].startTime).toBeGreaterThanOrEqual(102)
  })

  it('reserves time for 術はないよな before 嗚呼 when the transcript truncates early', () => {
    const lines = ['そんな僕に術はないよな', '嗚呼...', '何を間違った']
    const words: TranscriptWord[] = [
      { word: 'そんな', startTime: 60, endTime: 60.4 },
      { word: '僕に', startTime: 60.4, endTime: 60.8 },
      { word: '何を', startTime: 64, endTime: 64.4 },
      { word: '間違', startTime: 64.4, endTime: 64.8 },
      { word: 'った', startTime: 64.8, endTime: 65.1 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(60)
    expect(out[0].startTime).toBeLessThan(61)
    expect(out[1].startTime).toBeGreaterThan(60.8)
    expect(out[2].startTime).toBeGreaterThanOrEqual(64)
    expect(out[1].startTime).toBeLessThan(out[2].startTime)
  })

  it('keeps both chorus couplets separated when 僕らはきっと shares transcript timing', () => {
    const lines = [
      '僕らはきっとこの先も',
      '心絡まって ローリング ローリング',
      '凍てつく地面を転がるように走り出した',
      '僕らはきっとこの先も',
      '心絡まって ローリング ローリング',
    ]
    const words: TranscriptWord[] = [
      { word: '僕らはきっと', startTime: 100, endTime: 101.2 },
      { word: '心絡まって', startTime: 101.2, endTime: 102.4 },
      { word: 'ローリング', startTime: 102.4, endTime: 103.2 },
      { word: 'ローリング', startTime: 103.2, endTime: 104 },
      { word: '凍てつく', startTime: 110, endTime: 111 },
      { word: '地面を', startTime: 111, endTime: 112 },
      { word: '僕らはきっと', startTime: 200, endTime: 201.2 },
      { word: '心絡まって', startTime: 201.2, endTime: 202.4 },
      { word: 'ローリング', startTime: 202.4, endTime: 203.2 },
      { word: 'ローリング', startTime: 203.2, endTime: 204 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[1].startTime).toBeGreaterThan(out[0].startTime)
    expect(out[3].startTime).toBeGreaterThan(199)
    expect(out[4].startTime).toBeGreaterThan(out[3].startTime)
  })

  it('pulls 理由もないのに何だか悲しい earlier when Whisper only catches 悲しい', () => {
    const lines = ['理由もないのに何だか悲しい', '泣けやしないから 余計に救いがない']
    const words: TranscriptWord[] = [
      { word: '悲', startTime: 72, endTime: 72.2 },
      { word: 'し', startTime: 72.2, endTime: 72.45 },
      { word: 'い', startTime: 72.45, endTime: 72.9 },
      { word: '泣', startTime: 76, endTime: 76.3 },
      { word: 'け', startTime: 76.3, endTime: 76.6 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeLessThan(72)
    expect(out[1].startTime).toBeGreaterThanOrEqual(76)
  })

  it('holds 光輝いたように ように through the echoed second ように', () => {
    const lines = ['光輝いたように ように', '君の孤独も全て暴き出す朝だ']
    const words: TranscriptWord[] = [
      { word: '光輝', startTime: 140, endTime: 140.4 },
      { word: 'いた', startTime: 140.4, endTime: 140.8 },
      { word: 'ように', startTime: 140.8, endTime: 141.6 },
      { word: '君', startTime: 144, endTime: 144.3 },
      { word: 'の', startTime: 144.3, endTime: 144.5 },
      { word: '孤独', startTime: 144.5, endTime: 145 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeLessThan(141)
    expect(out[1].startTime).toBeGreaterThan(142)
  })

  it('covers 心絡まって before ローリング when the transcript only has the chorus tail', () => {
    const lines = ['心絡まって ローリング ローリング', '凍てつく地面を転がるように走り出した']
    const words: TranscriptWord[] = [
      { word: 'ローリング', startTime: 118, endTime: 118.8 },
      { word: 'ローリング', startTime: 118.8, endTime: 119.6 },
      { word: '凍', startTime: 122, endTime: 122.2 },
      { word: 'て', startTime: 122.2, endTime: 122.4 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeLessThan(118)
    expect(out[1].startTime).toBeGreaterThanOrEqual(122)
  })
})

describe('alignByContent (instrumental gap between lines)', () => {
  it('does not stretch a line\'s endTime across a long instrumental bridge to the next line', () => {
    // Line 1 is sung and clearly anchored at both ends (4s-6s). Line 2 starts
    // only after a long instrumental bridge, at 40s. Pre-fix, line 1's endTime
    // was always forced to line 2's startTime (40s), so a single short lyric
    // line would appear "active" for the entire 34s bridge. It should instead
    // end near its own last matched word, leaving the bridge as an unhighlighted
    // rest (the UI keys playback off startTime only).
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あ', startTime: 4, endTime: 4.4 },
      { word: 'お', startTime: 4.4, endTime: 4.8 },
      { word: 'ぞ', startTime: 4.8, endTime: 5.2 },
      { word: 'ら', startTime: 5.2, endTime: 5.6 },
      { word: 'ゆ', startTime: 40, endTime: 40.4 },
      { word: 'き', startTime: 40.4, endTime: 40.8 },
      { word: 'が', startTime: 40.8, endTime: 41.2 },
      { word: 'ふ', startTime: 41.2, endTime: 41.6 },
      { word: 'る', startTime: 41.6, endTime: 42 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].endTime).toBeLessThan(10)
    expect(out[0].endTime).toBeGreaterThanOrEqual(out[0].startTime)
  })
})
