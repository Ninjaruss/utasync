// src/sources/HomeScreen.tsx
import { useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'

type Mode = 'youtube' | 'upload'

interface Props {
  onSongReady: (songId: string) => void
}

export function HomeScreen({ onSongReady }: Props) {
  const [mode, setMode] = useState<Mode>('youtube')

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      <div className="flex justify-center gap-2 pt-6">
        <button
          onClick={() => setMode('youtube')}
          className={`px-4 py-1.5 rounded-full text-xs ${mode === 'youtube' ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}>
          YouTube link
        </button>
        <button
          onClick={() => setMode('upload')}
          className={`px-4 py-1.5 rounded-full text-xs ${mode === 'upload' ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}>
          Upload audio
        </button>
      </div>
      <div className="flex-1">
        {mode === 'youtube' ? <LinkParser onSongReady={onSongReady} /> : <UploadAudioFlow onSongReady={onSongReady} />}
      </div>
    </div>
  )
}
