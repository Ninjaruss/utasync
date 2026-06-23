import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TimedLine, FuriganaMode, LyricsLayout, ClozeDifficulty } from '../core/types'
import { lineIndexAtPlayhead } from './lineTiming'

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

function activeLineAtPosition(lines: TimedLine[], position: number): number {
  return lineIndexAtPlayhead(lines, position)
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
        const next = activeLineAtPosition(lines, position)
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
