// @vitest-environment node
//
// The Kotlin side of this pair (AuditDictionaryDigestTest) asserts that its dictionary reader
// reproduces the committed digest. That catches drift in the Kotlin reader. It does NOT
// distinguish "the Kotlin reader diverged" from "the data or the script changed and nobody
// regenerated the digest" — both show up as the same failed hash, and the Kotlin test's message
// says divergence, which would send the next person looking in the wrong place.
//
// So this half asserts the committed digest still equals a fresh conversion. Together: a stale
// digest fails here, with the command to fix it; a diverged reader fails in Kotlin.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generate, DIGEST, canonicalLines, digestOf } from '../../scripts/build-audit-digest.mjs'

describe('the audit dictionary digest', () => {
  it('is current: the committed file equals a fresh conversion of the real input', () => {
    // If this fails, run: node scripts/build-audit-digest.mjs
    // Then check the Kotlin audit's `right` count, because the dictionary it scores has changed.
    expect(readFileSync(DIGEST, 'utf8')).toBe(generate())
  })

  it('changes when a row changes, so it can actually detect drift', () => {
    const rows = [
      { surface: '空', reading: 'そら', posLabel: 'n', glosses: ['sky'], senseIndex: 0 },
      { surface: '空', reading: 'から', posLabel: 'adj', glosses: ['empty'], senseIndex: 1 },
    ]
    const surfaces = new Set(['空'])
    const base = digestOf(canonicalLines(rows, surfaces))
    for (const changed of [
      [{ ...rows[0], reading: 'くう' }, rows[1]],
      [{ ...rows[0], glosses: ['sky', 'heavens'] }, rows[1]],
      [{ ...rows[0], posLabel: null }, rows[1]],
      [{ ...rows[0], senseIndex: 5 }, rows[1]],
      [rows[0]],
    ]) {
      expect(digestOf(canonicalLines(changed, surfaces))).not.toBe(base)
    }
  })

  it('ignores row order, so neither side has to sort the same way', () => {
    const rows = [
      { surface: '空', reading: 'そら', posLabel: 'n', glosses: ['sky'], senseIndex: 0 },
      { surface: '空', reading: 'から', posLabel: 'adj', glosses: ['empty'], senseIndex: 1 },
    ]
    const surfaces = new Set(['空'])
    expect(digestOf(canonicalLines([...rows].reverse(), surfaces))).toBe(digestOf(canonicalLines(rows, surfaces)))
  })

  it('covers only the surfaces asked for', () => {
    const rows = [
      { surface: '空', reading: 'そら', posLabel: 'n', glosses: ['sky'], senseIndex: 0 },
      { surface: '海', reading: 'うみ', posLabel: 'n', glosses: ['sea'], senseIndex: 0 },
    ]
    expect(canonicalLines(rows, new Set(['空']))).toHaveLength(1)
    expect(canonicalLines(rows, new Set(['空', '海']))).toHaveLength(2)
  })
})
