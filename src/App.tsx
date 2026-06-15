import React, { useState } from 'react'
import { LinkParser } from './sources/LinkParser'
import { PlayerView } from './player/PlayerView'

export default function App() {
  const [songId, setSongId] = useState<string | null>(null)
  return songId
    ? <PlayerView songId={songId} onBack={() => setSongId(null)} />
    : <LinkParser onSongReady={setSongId} />
}
