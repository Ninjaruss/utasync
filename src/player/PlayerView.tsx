import React, { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { AudioEngine } from './AudioEngine'
import { LyricDisplay } from '../lyrics/LyricDisplay'
import { db } from '../core/db/schema'
import { YouTubePlayer } from './YouTubePlayer'
import { extractVideoId } from '../sources/youtube'
import { canUsePro } from '../payment/trial'
import { UpgradeModal } from '../payment/UpgradeModal'
import { ABLoopController } from './ABLoop'
import type { Song, TimedLine, Language } from '../core/types'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { toRomaji } from '../language/japanese/phonetics'
import { detectGrammarPatterns } from '../language/japanese/grammar'
import { tokenizeEnglish } from '../language/english/tokenizer'
import { sentenceToIPA } from '../language/english/phonetics'
import { detectEnglishGrammar } from '../language/english/grammar'

async function enrichLines(lines: TimedLine[], sourceLanguage: Language): Promise<TimedLine[]> {
  return Promise.all(lines.map(async (line): Promise<TimedLine> => {
    try {
      if (sourceLanguage === 'ja') {
        const [tokens, reading] = await Promise.all([
          tokenizeJapanese(line.original),
          toRomaji(line.original),
        ])
        const grammarAnnotations = detectGrammarPatterns(line.original)
        return { ...line, tokens, reading, grammarAnnotations }
      } else {
        const tokens = tokenizeEnglish(line.original)
        const reading = await sentenceToIPA(line.original)
        const grammarAnnotations = detectEnglishGrammar(line.original)
        return { ...line, tokens, reading, grammarAnnotations }
      }
    } catch {
      return line
    }
  }))
}

interface Props {
  songId: string
  onBack: () => void
  onSettings?: () => void
}

export function PlayerView({ songId, onBack, onSettings }: Props) {
  const engine = useRef<AudioEngine>(new AudioEngine())
  const abLoopControllerRef = useRef<ABLoopController | null>(null)
  const { playbackState, position, speed, abLoop, setPlaybackState, setPosition, setDuration, setSpeed, setABLoop } = usePlayerStore()
  const { syncPosition, setLines } = useLyricsStore()
  const [song, setSong] = useState<Song | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    db.songs.get(songId).then((s) => {
      if (s) {
        setSong(s)
        setLines(s.lyrics.lines)
        enrichLines(s.lyrics.lines, s.lyrics.sourceLanguage).then((enriched) => {
          setLines(enriched)
        })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  useEffect(() => {
    const e = engine.current
    e.onTimeUpdate((pos) => {
      setPosition(pos)
      syncPosition(pos)
      abLoopControllerRef.current?.tick()
    })
    e.onEnd(() => setPlaybackState('idle'))

    abLoopControllerRef.current = new ABLoopController(
      e,
      () => usePlayerStore.getState().abLoop,
      () => usePlayerStore.getState().position,
    )

    return () => {
      e.destroy()
      abLoopControllerRef.current?.destroy()
    }
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

  const ytVideoId = song?.sourceUrl ? extractVideoId(song.sourceUrl) : null
  const isYouTube = !!ytVideoId && !song?.audioStoredPath
  const isProUser = canUsePro(song?.isTrialSong ?? false)

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cinnabar-900">
        <button onClick={onBack} className="text-white/40 hover:text-white text-xs">← Back</button>
        <span className="text-cinnabar-accent font-semibold tracking-widest text-sm uppercase">歌sync</span>
        <button onClick={() => onSettings?.()} className="text-white/40 hover:text-white text-xs">Settings</button>
      </div>

      {/* YouTube embed */}
      {isYouTube && <YouTubePlayer videoId={ytVideoId} />}

      {/* Lyrics area */}
      <LyricDisplay onSeek={seek} />

      {/* Playback controls */}
      <div className="px-4 pt-2 space-y-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 24px), 24px)' }}>
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

        {/* Speed slider (Pro-gated) */}
        <div className="flex items-center gap-3">
          <span className="text-white/30 text-xs w-12">Speed</span>
          {isProUser ? (
            <>
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={speed * 100}
                onChange={(e) => setSpeed(Number(e.target.value) / 100)}
                className="flex-1 accent-cinnabar-accent"
              />
              <span className="text-white/50 text-xs w-10 text-right">{Math.round(speed * 100)}%</span>
            </>
          ) : (
            <button
              onClick={() => setShowUpgrade(true)}
              className="text-white/30 hover:text-white/60 text-sm"
            >
              🔒 Speed control
            </button>
          )}
        </div>

        {/* Buttons — only show for non-YouTube sources */}
        {!isYouTube && (
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => seek(Math.max(0, position - 5))}
              className="text-white/50 hover:text-white text-xl touch-manipulation">⏮</button>
            <button
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-cinnabar-accent text-white text-2xl flex items-center justify-center shadow-lg touch-manipulation"
              style={{ boxShadow: '0 0 20px rgba(248,113,113,0.4)' }}
            >
              {playbackState === 'playing' ? '⏸' : '▶'}
            </button>
            <button onClick={() => seek(Math.min(duration, position + 5))}
              className="text-white/50 hover:text-white text-xl touch-manipulation">⏭</button>
          </div>
        )}

        {/* A-B Loop controls (Pro-gated) */}
        {isProUser ? (
          <div className="flex gap-3 justify-center text-xs">
            <button onClick={() => setABLoop({ a: position })}
              className={`px-3 py-1 rounded-full border ${abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
              A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
            </button>
            <button onClick={() => setABLoop({ b: position })}
              className={`px-3 py-1 rounded-full border ${abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
              B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
            </button>
            <button onClick={() => setABLoop({ a: null, b: null })}
              className="px-3 py-1 rounded-full border border-white/20 text-white/30">
              Clear
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={() => setShowUpgrade(true)}
              className="text-white/30 hover:text-white/60 text-xs"
            >
              🔒 A-B Loop
            </button>
          </div>
        )}
      </div>

      {showUpgrade && (
        <UpgradeModal feature="Speed Control & A-B Loop" onClose={() => setShowUpgrade(false)} />
      )}
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
