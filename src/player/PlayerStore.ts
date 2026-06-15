import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackState, ABLoop } from '../core/types'

interface PlayerState {
  currentSongId: string | null
  playbackState: PlaybackState
  position: number
  duration: number
  speed: number
  abLoop: ABLoop
  setCurrentSong: (id: string | null) => void
  setPlaybackState: (state: PlaybackState) => void
  setPosition: (pos: number) => void
  setDuration: (dur: number) => void
  setSpeed: (speed: number) => void
  setABLoop: (loop: Partial<ABLoop>) => void
}

const DEFAULT_AB_LOOP: ABLoop = {
  a: null,
  b: null,
  preRoll: 2,
  loopCount: 3,
  crossfadeDuration: 0.3,
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      currentSongId: null,
      playbackState: 'idle',
      position: 0,
      duration: 0,
      speed: 1,
      abLoop: DEFAULT_AB_LOOP,
      setCurrentSong: (id) => set({ currentSongId: id, position: 0, playbackState: 'idle' }),
      setPlaybackState: (playbackState) => set({ playbackState }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setSpeed: (speed) => set({ speed }),
      setABLoop: (loop) => set((s) => ({ abLoop: { ...s.abLoop, ...loop } })),
    }),
    { name: 'utasync-player' }
  )
)
