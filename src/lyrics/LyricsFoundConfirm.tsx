import type { TimedLine } from '../core/types'
import type { LyricsLookupMatch } from '../sources/lrclib'
import { needsLyricsMatchConfirmation } from '../sources/lyricsMatch'

interface Props {
  queriedTitle: string
  queriedArtist: string
  lines: TimedLine[]
  synced: boolean
  sourceLabel: string
  match?: LyricsLookupMatch
  /** YouTube captions — no LRCLIB track metadata to compare. */
  fromVideoCaptions?: boolean
  confirmed: boolean
  onConfirm: () => void
  onUseDifferent: () => void
}

export function LyricsFoundConfirm({
  queriedTitle,
  queriedArtist,
  lines,
  synced,
  sourceLabel,
  match,
  fromVideoCaptions = false,
  confirmed,
  onConfirm,
  onUseDifferent,
}: Props) {
  const needsConfirm = needsLyricsMatchConfirmation(queriedTitle, queriedArtist, match)
  const preview = lines.slice(0, 3)

  return (
    <div className="space-y-2.5">
      <p className="text-green-400/90 text-sm text-pretty">
        Found {synced ? 'synced' : 'plain'} lyrics from {sourceLabel} ({lines.length} lines)
      </p>

      <div className="rounded-lg border border-cinnabar-800 bg-cinnabar-950/80 p-2.5 space-y-2 text-xs">
        <div>
          <p className="text-white/40 uppercase tracking-wide text-[10px] mb-0.5">Your song</p>
          <p className="text-white/80 text-pretty">
            <span className="font-medium">{queriedTitle.trim() || '—'}</span>
            {queriedArtist.trim() ? (
              <span className="text-white/50"> · {queriedArtist.trim()}</span>
            ) : null}
          </p>
        </div>

        {fromVideoCaptions ? (
          <p className="text-white/50 text-pretty leading-snug">
            Lyrics come from this video&apos;s captions — they should match the video you linked, not a separate LRCLIB entry.
          </p>
        ) : match ? (
          <div>
            <p className="text-white/40 uppercase tracking-wide text-[10px] mb-0.5">Matched in {sourceLabel}</p>
            <p className="text-white/80 text-pretty">
              <span className="font-medium">{match.track}</span>
              <span className="text-white/50"> · {match.artist}</span>
            </p>
            {match.matchKind === 'fuzzy' && (
              <p className="text-white/35 text-[11px] mt-1 text-pretty">Fuzzy search match — please confirm this is the same song.</p>
            )}
          </div>
        ) : null}

        {needsConfirm && !confirmed && (
          <p className="text-amber-400/90 text-[11px] text-pretty leading-snug">
            The title or artist from the lyrics database doesn&apos;t closely match what you entered. Confirm before using these lyrics.
          </p>
        )}
      </div>

      {preview.length > 0 && (
        <ul className="space-y-1 max-h-28 overflow-y-auto rounded-lg bg-cinnabar-950 border border-cinnabar-800 p-2">
          {preview.map((l, i) => (
            <li key={i} className="text-xs text-white/60 truncate font-jp">{l.original || '—'}</li>
          ))}
          {lines.length > preview.length && (
            <li className="text-[10px] text-white/30">+{lines.length - preview.length} more…</li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {needsConfirm && !confirmed && (
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-2 rounded-lg bg-cinnabar-accent text-white text-xs font-medium min-h-10 touch-manipulation"
          >
            Yes, this is the right song
          </button>
        )}
        <button
          type="button"
          onClick={onUseDifferent}
          className="px-3 py-2 rounded-lg bg-cinnabar-900 text-white/60 text-xs min-h-10 touch-manipulation hover:text-white/80"
        >
          Use different lyrics
        </button>
      </div>
    </div>
  )
}

/** Whether found lyrics can be applied (auto-ok or user confirmed). */
// eslint-disable-next-line react-refresh/only-export-components -- shared helper used by 4 callers; not worth a new file
export function lyricsFoundReadyToApply(
  queriedTitle: string,
  queriedArtist: string,
  match: LyricsLookupMatch | undefined,
  confirmed: boolean,
): boolean {
  if (!needsLyricsMatchConfirmation(queriedTitle, queriedArtist, match)) return true
  return confirmed
}
