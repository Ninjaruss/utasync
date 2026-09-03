import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCmudict } from '../../../scripts/build-cmudict.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('parseCmudict', () => {
  it('reads the plain word/phoneme form', () => {
    const { entries } = parseCmudict('guitar G IH0 T AA1 R\nlion L AY1 AH0 N\n')
    expect(entries.GUITAR).toBe('G IH0 T AA1 R')
    expect(entries.LION).toBe('L AY1 AH0 N')
  })

  it('strips the trailing provenance comment', () => {
    // "aalborg AO1 L B AO0 R G # place, danish"
    const { entries } = parseCmudict('aalborg AO1 L B AO0 R G # place, danish\n')
    expect(entries.AALBORG).toBe('AO1 L B AO0 R G')
  })

  it('keeps the canonical pronunciation and drops numbered alternates', () => {
    const { entries, variants } = parseCmudict('a AH0\na(2) EY1\n')
    expect(entries.A).toBe('AH0')
    expect(entries['A(2)']).toBeUndefined()
    expect(variants).toBe(1)
  })

  it('keeps words spelled with an apostrophe', () => {
    const { entries } = parseCmudict("don't D OW1 N T\n'bout B AW1 T\n")
    expect(entries["DON'T"]).toBe('D OW1 N T')
    expect(entries["'BOUT"]).toBe('B AW1 T')
  })

  it('ignores comment and blank lines', () => {
    const { entries } = parseCmudict(';;; header\n\nstar S T AA1 R\n')
    expect(Object.keys(entries)).toEqual(['STAR'])
  })

  it('builds a prototype-free map so "constructor" cannot leak an inherited value', () => {
    const { entries } = parseCmudict('constructor K AH0 N S T R AH1 K T ER0\n')
    expect(Object.getPrototypeOf(entries)).toBeNull()
    expect(entries.CONSTRUCTOR).toBe('K AH0 N S T R AH1 K T ER0')
  })
})

describe('the shipped lexicon', () => {
  const out = join(ROOT, 'public/cmudict.json')

  it('is the real dictionary, not the placeholder it replaced', () => {
    expect(existsSync(out)).toBe(true)
    const dict = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>
    // The stub had 15 words, which is why English readings rendered as raw text.
    expect(Object.keys(dict).length).toBeGreaterThan(100_000)
    for (const word of ['GUITAR', 'PLAYING', 'DARLING', 'SPACESHIP', "DON'T"]) {
      expect(dict[word], `${word} missing`).toBeTruthy()
    }
  })

  it('ships its license alongside', () => {
    const license = join(ROOT, 'public/licenses/cmudict.txt')
    expect(existsSync(license)).toBe(true)
    expect(readFileSync(license, 'utf8')).toContain('Carnegie Mellon University')
  })
})
