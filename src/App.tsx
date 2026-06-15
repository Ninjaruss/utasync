import React from 'react'
import { PlayerView } from './player/PlayerView'
import { useLyricsStore } from './lyrics/LyricsStore'
import { parseLRCPair } from './lyrics/lrc-parser'

const DEMO_JA = `[00:05.00]星に願いを
[00:08.00]夢の中で待ってる
[00:11.00]朝が来るまで
[00:14.00]ずっとここにいる`

const DEMO_EN = `[00:05.00]Wish upon a star
[00:08.00]Waiting in my dreams
[00:11.00]Until morning comes
[00:14.00]I'll always be here`

export default function App() {
  const { lines, setLines } = useLyricsStore()

  React.useEffect(() => {
    if (lines.length === 0) setLines(parseLRCPair(DEMO_JA, DEMO_EN))
  }, [])

  return <PlayerView />
}
