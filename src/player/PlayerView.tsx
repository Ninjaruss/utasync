import React, { useEffect, useRef } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { AudioEngine } from './AudioEngine'
import { LyricDisplay } from '../lyrics/LyricDisplay'
import { db } from '../core/db/schema'

interface Props {
  songId: string
  onBack: () => void
}

export function PlayerView({ songId, onBack }: Props) {
  const engine = useRef<AudioEngine>(new AudioEngine())
  const { playbackState, position, setPlaybackState, setPosition, setDuration } = usePlayerStore()
  const { syncPosition, setLines } = useLyricsStore()

  useEffect(() => {
    db.songs.get(songId).then((song) => {
      if (song) setLines(song.lyrics.lines)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  useEffect(() => {
    const e = engine.current
    e.onTimeUpdate((pos) => {
      setPosition(pos)
      syncPosition(pos)
    })
    e.onEnd(() => setPlaybackState('idle'))
    return () => e.destroy()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePlay = () => {
    if (playbackState === 'playing') {
      engine.current.pause()
      setPlaybackState('paused')
    } else {
      engine.current.play()
      setPlaybackState('playing')
    }
  }

  const seek = (time: number) => {
    engine.current.seek(time)
    setPosition(time)
  }

  const duration = engine.current.duration || 1
  const progress = position / duration

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cinnabar-900">
        <button onClick={onBack} className="text-white/40 hover:text-white text-xs">← Back</button>
        <span className="text-cinnabar-accent font-semibold tracking-widest text-sm uppercase">歌sync</span>
        <button className="text-white/40 hover:text-white text-xs">Settings</button>
      </div>

      {/* Lyrics area */}
      <LyricDisplay onSeek={seek} />

      {/* Playback controls */}
      <div className="px-4 pb-6 pt-2 space-y-3">
        {/* Seek bar */}
        <div
          className="h-1 bg-cinnabar-900 rounded cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seek(((e.clientX - rect.left) / rect.width) * duration)
          }}
        >
          <div
            className="h-full bg-cinnabar-accent rounded transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Time */}
        <div className="flex justify-between text-xs text-white/30">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-6">
          <button onClick={() => seek(Math.max(0, position - 5))}
            className="text-white/50 hover:text-white text-xl">⏮</button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full bg-cinnabar-accent text-white text-2xl flex items-center justify-center shadow-lg"
            style={{ boxShadow: '0 0 20px rgba(248,113,113,0.4)' }}
          >
            {playbackState === 'playing' ? '⏸' : '▶'}
          </button>
          <button onClick={() => seek(Math.min(duration, position + 5))}
            className="text-white/50 hover:text-white text-xl">⏭</button>
        </div>
      </div>
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
