// src/sources/HomeScreen.tsx
import { useEffect, useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'
import { SongLibrary } from './SongLibrary'
import { db } from '../core/db/schema'

type Mode = 'youtube' | 'upload' | 'songs'

interface Props {
  onSongReady: (songId: string) => void
}

export function HomeScreen({ onSongReady }: Props) {
  const [mode, setMode] = useState<Mode>('youtube')

  // Returning users with saved songs land on their library; new users keep the
  // YouTube-link default.
  useEffect(() => {
    db.songs.count().then((n) => { if (n > 0) setMode('songs') })
  }, [])

  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`px-4 py-1.5 rounded-full text-xs ${mode === m ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}>
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      <div className="flex justify-center gap-2 pt-6">
        {tab('youtube', 'YouTube link')}
        {tab('upload', 'Upload audio')}
        {tab('songs', 'My Songs')}
      </div>
      <div className="flex-1 flex flex-col">
        {mode === 'youtube' && <LinkParser onSongReady={onSongReady} />}
        {mode === 'upload' && <UploadAudioFlow onSongReady={onSongReady} />}
        {mode === 'songs' && <SongLibrary onOpen={onSongReady} />}
      </div>
    </div>
  )
}
