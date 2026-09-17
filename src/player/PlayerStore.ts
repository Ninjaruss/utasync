import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PlaybackState, ABLoop } from '../core/types'
import { safeLocalStorage } from '../core/storage/safeLocalStorage'

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
      setCurrentSong: (id) => set({
        currentSongId: id,
        position: 0,
        duration: 0,
        playbackState: 'idle',
        // A/B loop endpoints are timestamps in ONE song's audio; carrying them to a
        // different song would seek the wrong moments. Clear on a song switch (and
        // release a half-armed A/B tap) so a loop set on song 1 never applies to song 2.
        abLoop: { ...DEFAULT_AB_LOOP },
        armingAB: null,
      }),
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
        // `abLoop` (a/b) is intentionally NOT persisted: the endpoints are
        // song-relative and transient, and the other fields (preRoll/loopCount/
        // crossfadeDuration) are unused. Persisting them only rehydrated stale
        // timestamps onto whatever song opened next.
      }),
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
)
