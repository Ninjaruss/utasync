import { forwardRef, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer'
import { useMinWidthMd } from '../core/ui/useMinWidthMd'
import type { PlaybackState } from '../core/types'

const COLLAPSED_KEY = 'utasync-yt-panel-collapsed'

interface Props {
  videoId: string
  startSeconds: number
  position: number
  duration: number
  playbackState: PlaybackState
  mode: 'play' | 'edit'
  /** When false, only the source bar is shown (player lives off-screen elsewhere). */
  embedVisible: boolean
  onError: (code: number) => void
  onAttach: (file: File) => void
  attaching: boolean
  attachError?: string
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function readCollapsedPref(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== 'false'
  } catch {
    return true
  }
}

export const YouTubePlaybackPanel = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlaybackPanel(
  {
    videoId,
    startSeconds,
    position,
    duration,
    playbackState,
    mode,
    embedVisible,
    onError,
    onAttach,
    attaching,
    attachError,
  },
  ref,
) {
  const isDesktop = useMinWidthMd()
  const [collapsed, setCollapsed] = useState(readCollapsedPref)
  const inputRef = useRef<HTMLInputElement>(null)

  const showVideo = embedVisible && mode === 'play' && (isDesktop || !collapsed)

  useEffect(() => {
    if (isDesktop) return
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    } catch {
      /* ignore */
    }
  }, [collapsed, isDesktop])

  const handleAttachChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onAttach(file)
    e.target.value = ''
  }

  return (
    <div className="shrink-0 border-b border-cinnabar-900 pb-2 mb-2 md:pb-3 md:mb-3">
      {embedVisible && (
        <div
          className={
            showVideo
              ? 'w-full max-h-[28dvh] md:max-h-[200px] bg-black rounded-lg overflow-hidden md:rounded-md'
              : 'fixed top-0 w-[640px] h-[360px] pointer-events-none'
          }
          style={showVideo ? undefined : { left: '-9999px' }}
          aria-hidden={!showVideo}
        >
          <YouTubePlayer
            ref={ref}
            videoId={videoId}
            startSeconds={startSeconds}
            onError={onError}
          />
        </div>
      )}

      {embedVisible && !isDesktop && mode === 'play' && (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="mt-2 w-full flex items-center gap-2 min-h-10 px-2.5 rounded-lg bg-white/5 hover:bg-white/8 text-left touch-manipulation transition-colors duration-150"
          aria-expanded={!collapsed}
        >
          <span className="text-white/50 text-sm shrink-0" aria-hidden>
            {playbackState === 'playing' ? '▶' : '⏸'}
          </span>
          <span className="text-[11px] font-medium text-white/70 truncate flex-1">Video</span>
          <span className="text-[10px] text-white/35 tabular-nums shrink-0">
            {formatTime(position)} / {formatTime(duration)}
          </span>
          <span className="text-white/35 text-[10px] shrink-0" aria-hidden>
            {collapsed ? '▾' : '▴'}
          </span>
        </button>
      )}

      <div className={`flex items-center justify-between gap-2 ${!isDesktop && mode === 'play' ? 'mt-1.5' : 'mt-0 md:mt-2'}`}>
        <p className="text-[10px] text-white/40 text-pretty leading-snug hidden md:block flex-1">
          Streaming via YouTube — add audio to unlock AI align and export.
        </p>
        <p className="text-[10px] text-white/35 text-pretty leading-snug md:hidden flex-1">
          YouTube stream · add audio for AI align
        </p>
        <button
          type="button"
          aria-label="Add audio file"
          disabled={attaching}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 min-h-8 px-2.5 py-1 rounded-lg border border-cinnabar-accent/40 bg-cinnabar-accent/10 text-[10px] font-medium text-cinnabar-accent hover:bg-cinnabar-accent/15 disabled:opacity-40 touch-manipulation transition-colors duration-150"
        >
          {attaching ? 'Adding…' : '+ Audio'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-hidden
          onChange={handleAttachChange}
        />
      </div>
      {attachError && (
        <p className="text-[10px] text-red-400/90 mt-1" role="alert">{attachError}</p>
      )}
    </div>
  )
})
