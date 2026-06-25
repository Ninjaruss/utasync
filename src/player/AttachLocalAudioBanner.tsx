import { useRef, type ChangeEvent } from 'react'

interface Props {
  onAttach: (file: File) => void
  attaching: boolean
  error?: string
}

/** Shown for YouTube-streaming songs — prompts user to add a local file for AI align + export. */
export function AttachLocalAudioBanner({ onAttach, attaching, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onAttach(file)
    e.target.value = ''
  }

  return (
    <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-cinnabar-900/80 bg-cinnabar-900/25">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-white/55 text-pretty">
            Streaming via YouTube — add an audio file to unlock AI align and A-B export.
          </p>
          <p className="text-[10px] text-white/30 mt-0.5 text-pretty">
            Playback switches to your file once attached. Manual lyric timing still works now.
          </p>
        </div>
        <button
          type="button"
          aria-label="Add audio file"
          disabled={attaching}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 min-h-9 px-3 py-1.5 rounded-lg border border-cinnabar-accent/50 bg-cinnabar-accent/10 text-xs font-medium text-cinnabar-accent hover:bg-cinnabar-accent/15 disabled:opacity-40 touch-manipulation transition-[color,background-color,border-color] duration-150 ease-out"
        >
          {attaching ? 'Adding audio…' : 'Add audio file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-hidden
          onChange={handleChange}
        />
      </div>
      {error && (
        <p className="text-[10px] text-red-400/90 mt-1.5" role="alert">{error}</p>
      )}
    </div>
  )
}
