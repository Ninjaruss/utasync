import { describe, it, expect } from 'vitest'
import { exportLRC, exportSRT } from '../../src/lyrics/exporter'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 12.5, endTime: 15.2, original: '星に願いを', translation: 'Wish upon a star' },
  { startTime: 15.2, endTime: 18.9, original: '夢の中で', translation: 'In my dreams' },
]

describe('exportLRC', () => {
  it('produces valid LRC format', () => {
    const lrc = exportLRC(lines)
    expect(lrc).toContain('[00:12.50]')
    expect(lrc).toContain('星に願いを')
  })

  it('can export translation instead of original', () => {
    const lrc = exportLRC(lines, 'translation')
    expect(lrc).toContain('Wish upon a star')
  })
})

describe('exportSRT', () => {
  it('produces valid SRT format', () => {
    const srt = exportSRT(lines)
    expect(srt).toContain('1\n')
    expect(srt).toContain('00:00:12,500 --> 00:00:15,200')
    expect(srt).toContain('星に願いを')
  })
})
