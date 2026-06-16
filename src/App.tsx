import { useEffect, useState } from 'react'
import { LibraryScreen } from './sources/LibraryScreen'
import { AddSongSheet } from './sources/AddSongSheet'
import { PlayerView } from './player/PlayerView'
import { SettingsSheet } from './settings/SettingsSheet'
import { estimateQuota } from './core/storage/quota'
import { useToast } from './core/ui/Toast'

type View = 'library' | 'song'

export default function App() {
  const [view, setView] = useState<View>('library')
  const [songId, setSongId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    estimateQuota().then(({ ratio }) => {
      if (ratio > 0.8) toast('Storage nearly full. Open Settings to free space.', 'warning')
    })
  }, [toast])

  const openSong = (id: string) => {
    setSongId(id)
    setAddOpen(false)
    setView('song')
  }

  return (
    <>
      {view === 'song' && songId ? (
        <PlayerView
          songId={songId}
          onBack={() => setView('library')}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <LibraryScreen
          onOpen={openSong}
          onAdd={() => setAddOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {addOpen && <AddSongSheet onSongReady={openSong} onClose={() => setAddOpen(false)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
