/// <reference types="youtube" />
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'

interface Props {
  videoId: string
  /** Position (seconds) to resume from when the player is (re)created. */
  startSeconds?: number
  /** Hide the video and keep only the audio playing. */
  audioOnly?: boolean
}

export interface YouTubePlayerHandle {
  play: () => void
  pause: () => void
  seekTo: (seconds: number) => void
  setRate: (rate: number) => void
  setVolume: (volume: number) => void
}

declare global {
  interface Window { YT: typeof YT; onYouTubeIframeAPIReady: () => void }
}

function loadYTScript(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  return new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    window.onYouTubeIframeAPIReady = resolve
    document.head.appendChild(tag)
  })
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId, startSeconds = 0, audioOnly = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Captured at mount so the create-once effect resumes from the right spot.
  const startRef = useRef(startSeconds)
  const { setPosition, setPlaybackState, setDuration } = usePlayerStore()
  const { syncPosition } = useLyricsStore()

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.playVideo(),
    pause: () => playerRef.current?.pauseVideo(),
    seekTo: (seconds: number) => {
      playerRef.current?.seekTo(seconds, true)
      setPosition(seconds)
      syncPosition(seconds)
    },
    setRate: (rate: number) => {
      playerRef.current?.setPlaybackRate(rate)
    },
    setVolume: (volume: number) => {
      playerRef.current?.setVolume(Math.round(volume * 100))
    },
  }), [setPosition, syncPosition])

  useEffect(() => {
    let mounted = true
    const resumeAt = Math.floor(startRef.current)
    loadYTScript().then(() => {
      if (!mounted || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0, start: resumeAt, playsinline: 1 },
        events: {
          onReady: () => {
            const vol = usePlayerStore.getState().volume
            playerRef.current?.setVolume(Math.round(vol * 100))
            setDuration(playerRef.current?.getDuration() ?? 0)
            if (resumeAt > 0) {
              playerRef.current?.seekTo(resumeAt, true)
              setPosition(resumeAt)
              syncPosition(resumeAt)
            }
          },
          onStateChange: (e: YT.OnStateChangeEvent) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setPlaybackState('playing')
              setDuration(playerRef.current?.getDuration() ?? 0)
              tickerRef.current = setInterval(() => {
                const pos = playerRef.current?.getCurrentTime() ?? 0
                setPosition(pos)
                syncPosition(pos)
              }, 100)
            } else {
              setPlaybackState(e.data === window.YT.PlayerState.PAUSED ? 'paused' : 'idle')
              if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null }
            }
          },
        },
      })
    })
    return () => {
      mounted = false
      if (tickerRef.current) clearInterval(tickerRef.current)
      playerRef.current?.destroy()
    }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Audio-only: keep the iframe mounted (so it keeps playing) but off-screen.
  if (audioOnly) {
    return (
      <div aria-hidden className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden pointer-events-none">
        <div ref={containerRef} />
      </div>
    )
  }

  return <div ref={containerRef} className="w-full aspect-video" />
})
