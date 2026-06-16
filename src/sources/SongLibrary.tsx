import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong } from '../core/db/deleteSong'
import { linesAreTimed } from '../player/alignmentPolicy'
import type { Song } from '../core/types'

interface Props {
  onOpen: (songId: string) => void
}

export function SongLibrary({ onOpen }: Props) {
  const [songs, setSongs] = useState<Song[]>([])

  useEffect(() => {
    db.songs.orderBy('createdAt').reverse().toArray().then(setSongs)
  }, [])

  const handleDelete = async (song: Song) => {
    await deleteSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  if (songs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
        No songs yet
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {songs.map((song) => (
        <div
          key={song.id}
          onClick={() => onOpen(song.id)}
          className="bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-cinnabar-800 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-white">{song.title}</p>
            <p className="text-xs text-white/40">{song.artist}</p>
            <p className="text-[10px] text-white/30 mt-0.5">
              {linesAreTimed(song.lyrics.lines) ? 'Aligned' : 'Tap-sync needed'}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(song) }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}
