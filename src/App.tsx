import { useEffect, useState } from 'react'
import { LinkParser } from './sources/LinkParser'
import { PlayerView } from './player/PlayerView'
import { SettingsView } from './settings/SettingsView'
import { estimateQuota } from './core/storage/quota'
import { useToast } from './core/ui/Toast'

type View = 'home' | 'player' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [songId, setSongId] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    estimateQuota().then(({ ratio }) => {
      if (ratio > 0.8) toast('Storage nearly full. Visit Settings to free space.', 'warning')
    })
  }, [toast])

  if (view === 'settings') {
    return <SettingsView onClose={() => setView(songId ? 'player' : 'home')} />
  }

  if (view === 'player' && songId) {
    return (
      <PlayerView
        songId={songId}
        onBack={() => setView('home')}
        onSettings={() => setView('settings')}
      />
    )
  }

  return (
    <LinkParser
      onSongReady={(id) => {
        setSongId(id)
        setView('player')
      }}
    />
  )
}
