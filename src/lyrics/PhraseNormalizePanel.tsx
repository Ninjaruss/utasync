import type { PhraseChange } from './phraseLayout'

interface Props {
  changes: PhraseChange[]
  /** True when the song is currently rendered in the sung-phrase layout. */
  active: boolean
  busy?: boolean
  /** Switch the rendered rows to the sung phrases. */
  onApply: () => void
  /** Restore the original pasted layout. */
  onRevert: () => void
  /** Hide the panel without changing layout. */
  onDismiss: () => void
}

function ChangeRow({ change }: { change: PhraseChange }) {
  const isSplit = change.kind === 'split'
  return (
    <li className="rounded-lg bg-cinnabar-950 border border-cinnabar-800 p-2 space-y-1.5">
      <span
        className={[
          'inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded',
          isSplit ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300',
        ].join(' ')}
      >
        {isSplit ? 'Split' : 'Merge'}
      </span>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <ul className="space-y-0.5 min-w-0">
          {change.before.map((t, i) => (
            <li key={i} className="text-xs text-white/45 font-jp truncate">{t || '—'}</li>
          ))}
        </ul>
        <span aria-hidden className="text-white/30 text-sm">→</span>
        <ul className="space-y-0.5 min-w-0">
          {change.after.map((t, i) => (
            <li key={i} className="text-xs text-white/85 font-jp truncate">{t || '—'}</li>
          ))}
        </ul>
      </div>
    </li>
  )
}

export function PhraseNormalizePanel({ changes, active, busy = false, onApply, onRevert, onDismiss }: Props) {
  if (changes.length === 0) return null

  return (
    <section
      aria-label="Match song phrasing"
      className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 space-y-2.5"
    >
      <div className="space-y-0.5">
        <p className="text-sm text-white/85 font-medium text-pretty">Match song phrasing</p>
        <p className="text-[11px] text-white/45 text-pretty leading-snug">
          {active
            ? 'Showing the song’s sung phrasing. Restore your pasted rows any time.'
            : `${changes.length} ${changes.length === 1 ? 'row regroups' : 'rows regroup'} to match how the song is actually sung — clearer word pairing and seek points.`}
        </p>
      </div>

      <ul className="space-y-1.5 max-h-44 overflow-y-auto">
        {changes.map((c, i) => (
          <ChangeRow key={`${c.kind}-${c.sourceLineIndices.join('-')}-${i}`} change={c} />
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        {active ? (
          <button
            type="button"
            onClick={onRevert}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-cinnabar-accent text-white text-xs font-medium min-h-10 touch-manipulation disabled:opacity-50"
          >
            Restore pasted layout
          </button>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-cinnabar-accent text-white text-xs font-medium min-h-10 touch-manipulation disabled:opacity-50"
          >
            Match phrasing
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-cinnabar-900 text-white/60 text-xs min-h-10 touch-manipulation hover:text-white/80 disabled:opacity-50"
        >
          {active ? 'Hide' : 'Keep pasted rows'}
        </button>
      </div>
    </section>
  )
}
