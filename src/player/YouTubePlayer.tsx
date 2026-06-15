import React, { useEffect, useRef } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'

interface Props {
  videoId: string
}

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void }
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

export function YouTubePlayer({ videoId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { setPosition, setPlaybackState, setDuration } = usePlayerStore()
  const { syncPosition } = useLyricsStore()

  useEffect(() => {
    let mounted = true
    loadYTScript().then(() => {
      if (!mounted || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0 },
        events: {
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setPlaybackState('playing')
              setDuration(playerRef.current.getDuration())
              tickerRef.current = setInterval(() => {
                const pos = playerRef.current.getCurrentTime()
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

  return <div ref={containerRef} className="w-full aspect-video" />
}
