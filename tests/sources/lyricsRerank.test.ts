import { describe, it, expect } from 'vitest'
import { findCloserCandidate } from '../../src/sources/lyricsRerank'

const c = (id: number, duration?: number) => ({ id, duration })

describe('findCloserCandidate', () => {
  // Only speak up when the current match is genuinely wrong AND something better
  // exists. Prompting on a marginal score gap would nag about correct matches.
  it('offers a candidate inside tolerance when the current one is outside', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 230)], 230)?.id).toBe(2)
  })

  it('stays silent when the current match is already within tolerance', () => {
    expect(findCloserCandidate(c(1, 231), [c(1, 231), c(2, 230)], 230)).toBeNull()
  })

  it('stays silent when no candidate is within tolerance', () => {
    expect(findCloserCandidate(c(1, 300), [c(1, 300), c(2, 320)], 230)).toBeNull()
  })

  it('stays silent when the duration is unknown', () => {
    expect(findCloserCandidate(c(1, 300), [c(1, 300), c(2, 230)], undefined)).toBeNull()
  })

  // A zero length is what an unreadable file or an unstarted player reports.
  // Treated as "known", it matches an equally bogus zero-length candidate and
  // recommends swapping to it — a nonsense prompt from two pieces of garbage.
  it('treats a zero duration as unknown, not as a length to match', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 0)], 0)).toBeNull()
  })

  it('stays silent for a negative or infinite reported duration', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 230)], -5)).toBeNull()
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 230)], Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('stays silent when the current candidate has no duration to judge', () => {
    expect(findCloserCandidate(c(1), [c(1), c(2, 230)], 230)).toBeNull()
  })

  it('picks the closest when several are within tolerance', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250), c(2, 231.5), c(3, 230.2)], 230)?.id).toBe(3)
  })

  it('never offers the candidate already in use', () => {
    expect(findCloserCandidate(c(1, 250), [c(1, 250)], 230)).toBeNull()
  })
})
