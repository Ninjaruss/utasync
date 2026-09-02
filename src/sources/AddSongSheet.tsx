import { useRef, useState } from 'react'
import { useModalDialog } from '../core/ui/useModalDialog'
import { useHistoryDismiss } from '../core/ui/useHistoryDismiss'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { useConfirmedClose } from '../core/ui/useConfirmedClose'

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
      <p className={['text-[11px] text-white/70 md:mb-0 text-pretty', selected ? 'mb-2.5' : 'mb-0'].join(' ')}>{option.summary}</p>
      {/* These lists are how the user tells the two options apart — Upload gets AI
        * align and export, YouTube does not. `md:hidden` withheld exactly that from
        * desktop, where there is MORE room, not less. Still limited to the selected
        * tile, so only one set is ever on screen. */}
      <div className={[selected ? 'grid' : 'hidden', 'grid-cols-1 sm:grid-cols-2 gap-2.5'].join(' ')}>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/55 mb-1">Includes</p>
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
          <p className="text-[10px] uppercase tracking-wide text-white/55 mb-1">Limitations</p>
          <ul className="space-y-0.5">
            {option.limitations.map((item) => (
              <li key={item} className="text-[11px] text-white/60 text-pretty flex gap-1.5">
                <span className="text-white/50 shrink-0" aria-hidden>–</span>
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
  const [pendingSource, setPendingSource] = useState<Source | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { busy, dirty, setBusy, setDirty, confirming, requestClose, confirm, cancel } = useConfirmedClose(onClose)

  /* Switching tiles unmounts the active flow and everything in it. The tiles are
   * full-width and adjacent on a phone, so a mistap used to silently discard the
   * chosen file, the edited metadata and any pasted lyrics — the same work the ✕
   * and the backdrop already confirm before losing. */
  const requestSource = (next: Source) => {
    if (next === source) return
    if (busy || dirty) setPendingSource(next)
    else setSource(next)
  }

  const confirmSourceSwitch = () => {
    if (pendingSource) setSource(pendingSource)
    setPendingSource(null)
    // The old flow is unmounting, so its busy/dirty state goes with it. The
    // incoming flow reports its own; without this reset the sheet would still
    // think there was work to protect and confirm again on close.
    setBusy(false)
    setDirty(false)
  }
  // Routed through requestClose, so Escape gets the same "your pasted lyrics
  // will be lost" guard as the ✕ and the backdrop.
  useModalDialog(panelRef, requestClose)
  // Android's Back gesture is how people close sheets. Routed through the same
  // guard, so it can't silently discard pasted lyrics the way navigating away did.
  useHistoryDismiss(requestClose)

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={requestClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative bg-cinnabar-950 border-t md:border border-cinnabar-900 rounded-t-2xl md:rounded-2xl p-4 md:p-5 w-full md:max-w-3xl max-h-[92dvh] md:max-h-[min(92vh,54rem)] flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Add a song"
        aria-modal="true"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 1rem), 1rem)' }}
      >
        {/* One at a time: a close confirmation outranks a tile switch. */}
        {!confirming && pendingSource && (
          <ConfirmDialog
            title={pendingSource === 'link' ? 'Switch to YouTube link?' : 'Switch to Upload audio?'}
            message="What you've entered here — the file, the details and any pasted lyrics — will be lost."
            confirmLabel="Discard"
            cancelLabel="Keep what I have"
            onConfirm={confirmSourceSwitch}
            onCancel={() => setPendingSource(null)}
          />
        )}

        {confirming && (
          <ConfirmDialog
            title="Discard this song?"
            message={confirming === 'busy'
              ? 'Lyric search or saving is still in progress. Closing now will lose your progress.'
              : 'Your pasted lyrics will be lost.'}
            confirmLabel="Discard"
            cancelLabel="Keep working"
            onConfirm={confirm}
            onCancel={cancel}
          />
        )}

        <div className="flex items-center justify-between mb-2 md:mb-3 shrink-0">
          <h2 className="text-white font-semibold text-sm text-balance">Add a song</h2>
          <button
            aria-label="Close"
            onClick={requestClose}
            className="text-white/60 text-lg leading-none min-h-11 min-w-11 flex items-center justify-center touch-manipulation hover:text-white/70"
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
              onSelect={() => requestSource(option.id)}
            />
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col border-t border-cinnabar-900/80 pt-3 md:pt-4">
          {source === 'upload'
            ? <UploadAudioFlow embedded onSongReady={onSongReady} onBusyChange={setBusy} onDirtyChange={setDirty} />
            : <LinkParser embedded onSongReady={onSongReady} onBusyChange={setBusy} onDirtyChange={setDirty} />}
        </div>
      </div>
    </div>
  )
}
