import { useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'

type Source = 'link' | 'upload'

interface Props {
  onSongReady: (songId: string) => void
  onClose: () => void
}

export function AddSongSheet({ onSongReady, onClose }: Props) {
  const [source, setSource] = useState<Source>('link')

  const tab = (s: Source, label: string) => (
    <button onClick={() => setSource(s)}
      className={`flex-1 text-center text-xs py-2 rounded-lg border ${source === s ? 'border-cinnabar-accent bg-cinnabar-accent/12 text-cinnabar-accent font-medium' : 'border-cinnabar-800 text-white/50'}`}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Dismiss" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative bg-cinnabar-950 border-t border-cinnabar-900 rounded-t-2xl p-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-white font-semibold text-sm">Add a song</h2>
          <button aria-label="Close" onClick={onClose} className="text-white/40 text-lg leading-none">✕</button>
        </div>
        <div className="flex gap-2 mb-4 shrink-0">
          {tab('link', '🔗 Link')}
          {tab('upload', '⬆ Upload audio')}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {source === 'link'
            ? <LinkParser onSongReady={onSongReady} />
            : <UploadAudioFlow onSongReady={onSongReady} />}
        </div>
      </div>
    </div>
  )
}
