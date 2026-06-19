import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackState, ABLoop } from '../core/types'

interface PlayerState {
  currentSongId: string | null
  playbackState: PlaybackState
  position: number
  duration: number
  speed: number
  volume: number
  abLoop: ABLoop
  setCurrentSong: (id: string | null) => void
  setPlaybackState: (state: PlaybackState) => void
  setPosition: (pos: number) => void
  setDuration: (dur: number) => void
  setSpeed: (speed: number) => void
  setVolume: (volume: number) => void
  setABLoop: (loop: Partial<ABLoop>) => void
  armingAB: 'a' | 'b' | null
  armAB: (which: 'a' | 'b' | null) => void
}

/** Comfortable default for first-time users; persisted preference overrides this. */
export const DEFAULT_VOLUME = 0.75

const DEFAULT_AB_LOOP: ABLoop = {
  a: null,
  b: null,
  preRoll: 0,
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
      volume: DEFAULT_VOLUME,
      abLoop: DEFAULT_AB_LOOP,
      armingAB: null,
      setCurrentSong: (id) => set({ currentSongId: id, position: 0, playbackState: 'idle' }),
      setPlaybackState: (playbackState) => set({ playbackState }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setSpeed: (speed) => set({ speed }),
      setVolume: (volume) => set({ volume }),
      setABLoop: (loop) => set((s) => ({ abLoop: { ...s.abLoop, ...loop }, armingAB: null })),
      armAB: (armingAB) => set({ armingAB }),
    }),
    {
      name: 'utasync-player',
      partialize: (s) => ({
        currentSongId: s.currentSongId,
        position: s.position,
        speed: s.speed,
        volume: s.volume,
        abLoop: s.abLoop,
      }),
    }
  )
)
