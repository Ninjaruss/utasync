import { describe, it, expect } from 'vitest'
import { parseWordnetDataLine, parseWnjaDefLine, indexWnjaDefs } from '../../scripts/lib/wordnetDefs.mjs'

describe('parseWordnetDataLine (Princeton data.*)', () => {
  it('extracts lemmas and the definition (drops the "; example")', () => {
    const line = '00445055 04 n 02 spring 0 springtime 0 000 | the season of growth; "the emerging buds"'
    const r = parseWordnetDataLine(line)
    expect(r.words).toEqual(['spring', 'springtime'])
    expect(r.definition).toBe('the season of growth')
  })
  it('replaces underscores and drops adjective markers, ignores comment lines', () => {
    expect(parseWordnetDataLine('  1 this is licence text')).toBeNull()
    const r = parseWordnetDataLine('00001740 03 a 01 able(p) 0 000 | having the power')
    expect(r.words).toEqual(['able'])
  })
})

describe('parseWnjaDefLine + indexWnjaDefs (Japanese WordNet)', () => {
  it('keeps only Japanese-script definitions and joins to lemmas', () => {
    const defLines = [
      '00445055-n\t0\t成長する季節',
      '00445055-n\t1\tthe season of growth',
    ]
    const okLines = ['00445055-n\t春\thand', '00445055-n\t泉\thand']
    const parsedDefs = defLines.map(parseWnjaDefLine)
    const idx = indexWnjaDefs(okLines, parsedDefs, { cap: 3 })
    expect(idx['春']).toEqual(['成長する季節'])
    expect(idx['泉']).toEqual(['成長する季節'])
  })
})
