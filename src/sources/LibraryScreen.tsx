import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong } from '../core/db/deleteSong'
import { useAbLoopPlaylistStore } from '../player/abLoopPlaylistStore'
import { computeSyncState } from '../core/db/migrations'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { useToast } from '../core/ui/Toast'
import type { Song } from '../core/types'

interface Props {
  onOpen: (songId: string) => void
  onAdd: () => void
  onSettings: () => void
  /** Bump to refetch songs — e.g. after a delete in the Settings overlay while this screen stays mounted. */
  refreshKey?: number
}

export function LibraryScreen({ onOpen, onAdd, onSettings, refreshKey = 0 }: Props) {
  // null = query still loading; keeps the empty state from flashing for returning users.
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Song | null>(null)
  const toast = useToast()

  useEffect(() => {
    // Cancellation guards against rapid refreshKey bumps racing (a stale result
    // could resurrect a deleted card) and against setState after unmount.
    let cancelled = false
    db.songs.orderBy('createdAt').reverse().toArray().then((rows) => {
      if (!cancelled) setSongs(rows)
    })
    return () => { cancelled = true }
  }, [refreshKey])

  const handleDelete = async (song: Song) => {
    setPendingDelete(null)
    try {
      const { audioDeleteFailed } = await deleteSong(song)
      useAbLoopPlaylistStore.getState().clearPlaylist(song.id)
      setSongs((prev) => prev && prev.filter((s) => s.id !== song.id))
      if (audioDeleteFailed) {
        toast('Song removed, but the audio file could not be deleted. Open Settings → Storage to reclaim space.', 'warning')
      }
    } catch {
      toast('Could not delete song. Please try again.', 'error')
    }
  }

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-cinnabar-950 flex flex-col">
      <div className="w-full max-w-2xl mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-4 py-4 shrink-0">
          <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
          <button
            type="button"
            onClick={onSettings}
            className="min-h-11 px-3 text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out"
          >
            ⚙ Settings
          </button>
        </div>

        <div className="px-4 pb-3 shrink-0">
          <button
            type="button"
            onClick={onAdd}
            className="w-full py-3 rounded-xl bg-cinnabar-accent text-white font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-[transform,background-color] duration-150 ease-out active:scale-[0.98]"
          >
            ＋ Add a song
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
          {songs === null && (
            <>
              <p role="status" className="sr-only">Loading songs…</p>
              <div aria-hidden="true" className="space-y-2 animate-pulse">
                <div className="bg-cinnabar-900/50 rounded-xl min-h-[3.75rem]" />
                <div className="bg-cinnabar-900/50 rounded-xl min-h-[3.75rem]" />
              </div>
            </>
          )}
          {songs?.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-24 px-6 animate-[progress-enter_220ms_ease-out_both]">
              <div className="w-12 h-12 rounded-2xl bg-cinnabar-900 border border-cinnabar-800 flex items-center justify-center text-cinnabar-accent/70 text-xl mb-1">♪</div>
              <p className="text-white/55 text-sm font-medium text-balance">Your library is empty</p>
              <p className="text-white/30 text-xs text-pretty max-w-[16rem] leading-relaxed">
                Add a song from a YouTube link or an audio file to start syncing lyrics.
              </p>
            </div>
          )}
          {(songs ?? []).map((song) => {
            const sync = song.syncState ?? computeSyncState(song)
            return (
              <div
                key={song.id}
                className="relative bg-cinnabar-900 rounded-xl flex items-center gap-3 min-h-[3.75rem] hover:bg-cinnabar-800 transition-[background-color] duration-150 ease-out"
              >
                {/* Keyboard-accessible card tap target */}
                <button
                  type="button"
                  onClick={() => onOpen(song.id)}
                  aria-label={`Open ${song.title}${song.artist ? ` by ${song.artist}` : ''}`}
                  className="absolute inset-0 rounded-xl touch-manipulation active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar-accent/60"
                />
                <div className="pointer-events-none flex items-center gap-3 p-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-cinnabar-accent to-cinnabar-800 shrink-0 overflow-hidden">
                    {song.albumArtUrl && <img src={song.albumArtUrl} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{song.title}</p>
                    <p className="text-xs text-white/40 truncate">{song.artist}</p>
                  </div>
                  <span className={`text-[10px] rounded-full border px-2 py-0.5 shrink-0 ${sync === 'synced' ? 'border-white/20 text-white/50' : 'border-cinnabar-accent/60 text-cinnabar-accent'}`}>
                    {sync === 'synced' ? 'synced' : 'needs sync'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(song) }}
                  className="relative z-10 min-w-11 min-h-11 flex items-center justify-center text-xs text-red-400 hover:text-red-300 shrink-0 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96] mr-0.5"
                  aria-label={`Delete ${song.title}`}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete song?"
          message={`"${pendingDelete.title}" and its saved audio/lyrics will be permanently removed.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
