/** A hard timing pin: line `lineIndex` starts exactly at `time` (seconds). */
export interface TimingAnchor {
  lineIndex: number
  time: number
  source: 'user' | 'auto-start' | 'auto-end'
}
