import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TimedLine, PhoneticMode, ClozeDifficulty } from '../core/types'

interface LyricsState {
  lines: TimedLine[]
  activeLine: number
  phoneticMode: PhoneticMode
  clozeMode: boolean
  clozeDifficulty: ClozeDifficulty
  setLines: (lines: TimedLine[]) => void
  syncPosition: (position: number) => void
  setPhoneticMode: (mode: PhoneticMode) => void
  setClozeMode: (on: boolean) => void
}

function binarySearchLine(lines: TimedLine[], position: number): number {
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].startTime <= position) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

export const useLyricsStore = create<LyricsState>()(
  persist(
    (set, get) => ({
      lines: [],
      activeLine: -1,
      phoneticMode: 'reading',
      clozeMode: false,
      clozeDifficulty: 'medium',
      setLines: (lines) => set({ lines, activeLine: -1 }),
      syncPosition: (position) => {
        const { lines, activeLine } = get()
        const next = binarySearchLine(lines, position)
        if (next !== activeLine) set({ activeLine: next })
      },
      setPhoneticMode: (phoneticMode) => set({ phoneticMode }),
      setClozeMode: (clozeMode) => set({ clozeMode }),
    }),
    { name: 'utasync-lyrics', partialize: (s) => ({ phoneticMode: s.phoneticMode, clozeDifficulty: s.clozeDifficulty }) }
  )
)
