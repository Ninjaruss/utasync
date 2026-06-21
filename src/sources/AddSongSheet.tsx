import { useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'

type Source = 'upload' | 'link'

interface Props {
  onSongReady: (songId: string) => void
  onClose: () => void
}

interface SourceOption {
  id: Source
  title: string
  badge?: string
  summary: string
  includes: string[]
  limitations: string[]
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    id: 'upload',
    title: 'Upload audio',
    badge: 'Recommended',
    summary: 'Full toolkit — best for learning and practice.',
    includes: [
      'AI auto-align lyrics',
      'A-B loop export',
      'Offline playback',
      'Reliable speed control',
    ],
    limitations: [
      'Need an audio file on your device',
    ],
  },
  {
    id: 'link',
    title: 'YouTube link',
    summary: 'Quick start when you only have a video URL.',
    includes: [
      'Instant playback via YouTube',
      'Lyric search from title & artist',
      'Manual timing in Edit mode',
      'A-B loop practice',
    ],
    limitations: [
      'No AI auto-align or clip export',
      'Requires internet',
      'Some videos limit playback speed',
    ],
  },
]

function SourceTile({
  option,
  selected,
  onSelect,
}: {
  option: SourceOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full text-left rounded-xl border p-3 md:p-2.5 touch-manipulation transition-[color,background-color,border-color,box-shadow] duration-150 ease-out',
        selected
          ? 'border-cinnabar-accent/60 bg-cinnabar-accent/10 shadow-sm shadow-cinnabar-accent/10'
          : 'border-cinnabar-800 bg-cinnabar-900/40 hover:border-cinnabar-accent/30 hover:bg-cinnabar-900/60',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-1 md:mb-0.5">
        <span className="text-sm font-semibold text-white/90">{option.title}</span>
        {option.badge && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide font-medium text-cinnabar-accent bg-cinnabar-accent/15 border border-cinnabar-accent/30 rounded-full px-2 py-0.5">
            {option.badge}
          </span>
        )}
      </div>
      <p className="text-[11px] text-white/45 md:mb-0 mb-2.5 text-pretty">{option.summary}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:hidden">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Includes</p>
          <ul className="space-y-0.5">
            {option.includes.map((item) => (
              <li key={item} className="text-[11px] text-white/55 text-pretty flex gap-1.5">
                <span className="text-green-400/80 shrink-0" aria-hidden>✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Limitations</p>
          <ul className="space-y-0.5">
            {option.limitations.map((item) => (
              <li key={item} className="text-[11px] text-white/40 text-pretty flex gap-1.5">
                <span className="text-white/25 shrink-0" aria-hidden>–</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </button>
  )
}

export function AddSongSheet({ onSongReady, onClose }: Props) {
  const [source, setSource] = useState<Source>('upload')
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const requestClose = () => {
    if (busy) setConfirmClose(true)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={requestClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="relative bg-cinnabar-950 border-t md:border border-cinnabar-900 rounded-t-2xl md:rounded-2xl p-4 md:p-5 w-full md:max-w-3xl max-h-[90dvh] md:max-h-[min(90vh,44rem)] flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Add a song"
        aria-modal="true"
      >
        {confirmClose && (
          <ConfirmDialog
            title="Discard this song?"
            message="Lyric search or saving is still in progress. Closing now will lose your progress."
            confirmLabel="Discard"
            cancelLabel="Keep working"
            onConfirm={() => { setConfirmClose(false); onClose() }}
            onCancel={() => setConfirmClose(false)}
          />
        )}

        <div className="flex items-center justify-between mb-2 md:mb-3 shrink-0">
          <h2 className="text-white font-semibold text-sm text-balance">Add a song</h2>
          <button
            aria-label="Close"
            onClick={requestClose}
            className="text-white/40 text-lg leading-none min-h-11 min-w-11 flex items-center justify-center touch-manipulation hover:text-white/70"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3 md:mb-4 shrink-0">
          {SOURCE_OPTIONS.map((option) => (
            <SourceTile
              key={option.id}
              option={option}
              selected={source === option.id}
              onSelect={() => setSource(option.id)}
            />
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col border-t border-cinnabar-900/80 pt-3 md:pt-4">
          {source === 'upload'
            ? <UploadAudioFlow embedded onSongReady={onSongReady} onBusyChange={setBusy} />
            : <LinkParser embedded onSongReady={onSongReady} onBusyChange={setBusy} />}
        </div>
      </div>
    </div>
  )
}
