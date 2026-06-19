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

/** YouTube often reports 0 or a partial buffer length until metadata settles. */
function readStableDuration(player: YT.Player, lastSeen: number): number {
  const d = player.getDuration()
  if (!Number.isFinite(d) || d <= 0) return lastSeen
  return Math.max(lastSeen, d)
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId, startSeconds = 0, audioOnly = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationSeenRef = useRef(0)
  const startRef = useRef(startSeconds)
  const { setPosition, setPlaybackState, setDuration } = usePlayerStore()
  const { syncPosition } = useLyricsStore()

  const publishDuration = (player: YT.Player) => {
    const next = readStableDuration(player, durationSeenRef.current)
    if (next > durationSeenRef.current) {
      durationSeenRef.current = next
      setDuration(next)
    }
  }

  const stopDurationPoll = () => {
    if (durationPollRef.current) {
      clearInterval(durationPollRef.current)
      durationPollRef.current = null
    }
  }

  const startDurationPoll = (player: YT.Player) => {
    stopDurationPoll()
    let stableTicks = 0
    durationPollRef.current = setInterval(() => {
      const before = durationSeenRef.current
      publishDuration(player)
      if (durationSeenRef.current > 0 && durationSeenRef.current === before) {
        stableTicks++
        if (stableTicks >= 2) stopDurationPoll()
      } else {
        stableTicks = 0
      }
    }, 400)
  }

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
    durationSeenRef.current = 0

    loadYTScript().then(() => {
      if (!mounted || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            const player = e.target
            const vol = usePlayerStore.getState().volume
            player.setVolume(Math.round(vol * 100))
            if (resumeAt > 0) {
              player.seekTo(resumeAt, true)
              setPosition(resumeAt)
              syncPosition(resumeAt)
            }
            publishDuration(player)
            startDurationPoll(player)
          },
          onStateChange: (e: YT.OnStateChangeEvent) => {
            const player = e.target
            if (e.data === window.YT.PlayerState.PLAYING) {
              setPlaybackState('playing')
              publishDuration(player)
              startDurationPoll(player)
              tickerRef.current = setInterval(() => {
                const pos = player.getCurrentTime() ?? 0
                setPosition(pos)
                syncPosition(pos)
              }, 100)
            } else {
              setPlaybackState(e.data === window.YT.PlayerState.PAUSED ? 'paused' : 'idle')
              if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null }
              if (e.data === window.YT.PlayerState.ENDED) {
                publishDuration(player)
                stopDurationPoll()
              }
            }
          },
        },
      })
    })
    return () => {
      mounted = false
      if (tickerRef.current) clearInterval(tickerRef.current)
      stopDurationPoll()
      playerRef.current?.destroy()
    }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (audioOnly) {
    return (
      <div aria-hidden className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden pointer-events-none">
        <div ref={containerRef} />
      </div>
    )
  }

  return <div ref={containerRef} className="w-full aspect-video" />
})
