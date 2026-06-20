import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ABLoopPlaylistEntry } from '../core/types'
import {
  DEFAULT_PLAYLIST_REPEAT_COUNT,
  movePlaylistEntryByIndex,
  normalizePlaylistRepeatCount,
} from './abLoopPlaylist'

interface AbLoopPlaylistState {
  /** Saved loop segments keyed by song id. */
  playlists: Record<string, ABLoopPlaylistEntry[]>
  /** How many A–B cycles each entry plays before auto-advancing (0 = infinite). */
  playlistRepeatCount: number
  /** Active playlist session (not persisted across reloads). */
  playlistActive: boolean
  playlistIndex: number
  addEntry: (songId: string, entry: ABLoopPlaylistEntry) => void
  removeEntry: (songId: string, entryId: string) => void
  renameEntry: (songId: string, entryId: string, label: string) => void
  moveEntry: (songId: string, from: number, to: number) => void
  clearPlaylist: (songId: string) => void
  setPlaylistActive: (active: boolean) => void
  setPlaylistIndex: (index: number) => void
  setPlaylistRepeatCount: (count: number) => void
  resetSession: () => void
}

export const useAbLoopPlaylistStore = create<AbLoopPlaylistState>()(
  persist(
    (set) => ({
      playlists: {},
      playlistRepeatCount: DEFAULT_PLAYLIST_REPEAT_COUNT,
      playlistActive: false,
      playlistIndex: 0,
      addEntry: (songId, entry) =>
        set((s) => ({
          playlists: {
            ...s.playlists,
            [songId]: [...(s.playlists[songId] ?? []), entry],
          },
        })),
      removeEntry: (songId, entryId) =>
        set((s) => {
          const entries = (s.playlists[songId] ?? []).filter((e) => e.id !== entryId)
          const nextPlaylists = { ...s.playlists, [songId]: entries }
          if (entries.length === 0) delete nextPlaylists[songId]
          const index = Math.min(s.playlistIndex, Math.max(0, entries.length - 1))
          return {
            playlists: nextPlaylists,
            playlistIndex: index,
            playlistActive: s.playlistActive && entries.length > 0,
          }
        }),
      renameEntry: (songId, entryId, label) =>
        set((s) => ({
          playlists: {
            ...s.playlists,
            [songId]: (s.playlists[songId] ?? []).map((e) =>
              e.id === entryId ? { ...e, label: label.trim() || undefined } : e,
            ),
          },
        })),
      moveEntry: (songId, from, to) =>
        set((s) => ({
          playlists: {
            ...s.playlists,
            [songId]: movePlaylistEntryByIndex(s.playlists[songId] ?? [], from, to),
          },
        })),
      clearPlaylist: (songId) =>
        set((s) => {
          const next = { ...s.playlists }
          delete next[songId]
          return {
            playlists: next,
            playlistActive: false,
            playlistIndex: 0,
          }
        }),
      setPlaylistActive: (playlistActive) => set({ playlistActive }),
      setPlaylistIndex: (playlistIndex) => set({ playlistIndex }),
      setPlaylistRepeatCount: (count) =>
        set({ playlistRepeatCount: normalizePlaylistRepeatCount(count) }),
      resetSession: () => set({ playlistActive: false, playlistIndex: 0 }),
    }),
    {
      name: 'utasync-ab-loop-playlists',
      partialize: (s) => ({
        playlists: s.playlists,
        playlistRepeatCount: s.playlistRepeatCount,
      }),
    },
  ),
)
