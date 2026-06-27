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
  onError?: (code: number) => void
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

let ytScriptPromise: Promise<void> | null = null

function loadYTScript(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (!ytScriptPromise) {
    ytScriptPromise = new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled || !window.YT?.Player) return
        settled = true
        window.clearInterval(poll)
        resolve()
      }
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        finish()
      }
      const poll = window.setInterval(finish, 100)
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script')
        tag.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(tag)
      }
    })
  }
  return ytScriptPromise
}

/** YouTube often reports 0 or a partial buffer length until metadata settles. */
function readStableDuration(player: YT.Player, lastSeen: number): number {
  const d = player.getDuration()
  if (!Number.isFinite(d) || d <= 0) return lastSeen
  return Math.max(lastSeen, d)
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId, startSeconds = 0, audioOnly = false, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationSeenRef = useRef(0)
  const startRef = useRef(startSeconds)
  const readyRef = useRef(false)
  const pendingActionRef = useRef<'play' | 'pause' | null>(null)
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

  const runPendingAction = (player: YT.Player) => {
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (action === 'play') player.playVideo()
    else if (action === 'pause') player.pauseVideo()
  }

  useImperativeHandle(ref, () => ({
    play: () => {
      const player = playerRef.current
      if (readyRef.current && player) player.playVideo()
      else pendingActionRef.current = 'play'
    },
    pause: () => {
      const player = playerRef.current
      if (readyRef.current && player) player.pauseVideo()
      else pendingActionRef.current = 'pause'
    },
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
    readyRef.current = false
    pendingActionRef.current = null

    loadYTScript().then(() => {
      if (!mounted || !containerRef.current) return
      const origin = window.location.origin
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 0,
          rel: 0,
          playsinline: 1,
          origin,
        },
        events: {
          onReady: (e) => {
            const player = e.target
            readyRef.current = true
            const vol = usePlayerStore.getState().volume
            player.setVolume(Math.round(vol * 100))
            if (resumeAt > 0) {
              player.seekTo(resumeAt, true)
              setPosition(resumeAt)
              syncPosition(resumeAt)
            }
            publishDuration(player)
            startDurationPoll(player)
            runPendingAction(player)
          },
          onError: (e: YT.OnErrorEvent) => {
            onError?.(e.data)
            setPlaybackState('idle')
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
      readyRef.current = false
      pendingActionRef.current = null
      if (tickerRef.current) clearInterval(tickerRef.current)
      stopDurationPoll()
      playerRef.current?.destroy()
    }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (audioOnly) {
    // Keep off-screen but fully opaque — Firefox never initializes hidden iframes.
    return (
      <div
        aria-hidden
        className="fixed top-0 w-[640px] h-[360px] pointer-events-none"
        style={{ left: '-9999px' }}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    )
  }

  return <div ref={containerRef} className="w-full aspect-video bg-black" />
})
