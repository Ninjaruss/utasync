import { describe, it, expect } from 'vitest'
import { parseLRC, parseLRCPair } from '../../src/lyrics/lrc-parser'

const jaLRC = `[00:12.50]星に願いを
[00:15.20]夢の中で待ってる
[00:18.90]朝が来るまで`

const enLRC = `[00:12.50]Wish upon a star
[00:15.20]Waiting in my dreams
[00:18.90]Until morning comes`

describe('parseLRC', () => {
  it('parses timestamps correctly', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].startTime).toBeCloseTo(12.5)
    expect(lines[1].startTime).toBeCloseTo(15.2)
  })

  it('parses text content', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].original).toBe('星に願いを')
  })

  it('sets endTime to next line startTime', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[0].endTime).toBeCloseTo(15.2)
  })

  it('sets last line endTime to startTime + 5', () => {
    const lines = parseLRC(jaLRC)
    expect(lines[2].endTime).toBeCloseTo(23.9)
  })

  it('skips metadata lines', () => {
    const lrc = `[ti:Test Song]\n[ar:Artist]\n[00:01.00]Line one`
    const lines = parseLRC(lrc)
    expect(lines).toHaveLength(1)
    expect(lines[0].original).toBe('Line one')
  })

  it('returns empty array for empty input', () => {
    expect(parseLRC('')).toEqual([])
  })
})

describe('parseLRCPair', () => {
  it('merges two LRC files into bilingual lines', () => {
    const lines = parseLRCPair(jaLRC, enLRC)
    expect(lines[0].original).toBe('星に願いを')
    expect(lines[0].translation).toBe('Wish upon a star')
    expect(lines[0].startTime).toBeCloseTo(12.5)
  })

  it('handles mismatched line counts gracefully', () => {
    const shortEn = `[00:12.50]Wish upon a star`
    const lines = parseLRCPair(jaLRC, shortEn)
    expect(lines).toHaveLength(3)
    expect(lines[1].translation).toBe('')
  })
})
