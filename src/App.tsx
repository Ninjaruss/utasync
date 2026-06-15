import React, { useState } from 'react'
import { LinkParser } from './sources/LinkParser'
import { PlayerView } from './player/PlayerView'
import { SettingsView } from './settings/SettingsView'

type View = 'home' | 'player' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [songId, setSongId] = useState<string | null>(null)

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
