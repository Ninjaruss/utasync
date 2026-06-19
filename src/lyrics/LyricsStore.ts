import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TimedLine, FuriganaMode, LyricsLayout, ClozeDifficulty } from '../core/types'

interface LyricsState {
  lines: TimedLine[]
  activeLine: number
  furiganaMode: FuriganaMode
  showTranslation: boolean
  lyricsLayout: LyricsLayout
  clozeMode: boolean
  clozeDifficulty: ClozeDifficulty
  setLines: (lines: TimedLine[]) => void
  syncPosition: (position: number) => void
  setFuriganaMode: (mode: FuriganaMode) => void
  setShowTranslation: (on: boolean) => void
  setLyricsLayout: (layout: LyricsLayout) => void
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
      furiganaMode: 'furigana',
      showTranslation: true,
      lyricsLayout: 'stacked',
      clozeMode: false,
      clozeDifficulty: 'medium',
      setLines: (lines) => set({ lines, activeLine: -1 }),
      syncPosition: (position) => {
        const { lines, activeLine } = get()
        const next = binarySearchLine(lines, position)
        if (next !== activeLine) set({ activeLine: next })
      },
      setFuriganaMode: (furiganaMode) => set({ furiganaMode }),
      setShowTranslation: (showTranslation) => set((state) => ({
        showTranslation,
        // Side-by-side only makes sense with translation visible.
        lyricsLayout: showTranslation ? state.lyricsLayout : 'stacked',
      })),
      setLyricsLayout: (lyricsLayout) => set({ lyricsLayout }),
      setClozeMode: (clozeMode) => set({ clozeMode }),
    }),
    {
      name: 'utasync-lyrics',
      partialize: (s) => ({
        furiganaMode: s.furiganaMode,
        showTranslation: s.showTranslation,
        lyricsLayout: s.lyricsLayout,
        clozeDifficulty: s.clozeDifficulty,
      }),
    }
  )
)
