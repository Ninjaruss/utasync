import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { TimedLine, Language } from '../core/types'
import { linesFromPlainText } from '../sources/songBuilder'
import { parseSubtitle } from './subtitle-parser'
import { resolveLyricsForSong, lyricsSourceLabel, type LyricsResolveSource } from '../sources/lyricsResolver'
import { normalizeImportedLines } from '../sources/importNormalize'
import { LyricsFoundConfirm, lyricsFoundReadyToApply } from './LyricsFoundConfirm'
import type { LyricsLookupMatch } from '../sources/lrclib'
import { getDefaultSongLanguage } from '../payment/SettingsStore'

type ManualLyricSource = 'paste' | 'subtitle'

type LyricsPhase =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; lines: TimedLine[]; synced: boolean; source: LyricsResolveSource; match?: LyricsLookupMatch }
  | { kind: 'manual'; source: ManualLyricSource }

interface Props {
  title: string
  artist: string
  videoId?: string | null
  sourceLanguage?: Language
  /** Called when user confirms a lyrics set. */
  onApply: (lines: TimedLine[]) => void
  onCancel: () => void
  onBusyChange?: (busy: boolean) => void
  applyLabel?: string
}

export function LyricsImportPanel({
  title,
  artist,
  videoId,
  sourceLanguage,
  onApply,
  onCancel,
  onBusyChange,
  applyLabel = 'Use these lyrics',
}: Props) {
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [matchConfirmed, setMatchConfirmed] = useState(false)
  const searchGenRef = useRef(0)

  const isBusy = applying || lyricsPhase.kind === 'searching'
  useEffect(() => {
    onBusyChange?.(isBusy)
  }, [isBusy, onBusyChange])

  const runSearch = () => {
    if (!title.trim()) return
    const gen = ++searchGenRef.current
    setLyricsPhase({ kind: 'searching' })
    setError('')

    resolveLyricsForSong({ title, artist, videoId, sourceLanguage: sourceLanguage ?? getDefaultSongLanguage() })
      .then((result) => {
        if (gen !== searchGenRef.current) return
        if (result.lines.length > 0) {
          setMatchConfirmed(false)
          setLyricsPhase({
            kind: 'found',
            lines: result.lines,
            synced: result.synced,
            source: result.source,
            match: result.match,
          })
        } else {
          setLyricsPhase({ kind: 'manual', source: 'paste' })
        }
      })
      .catch(() => {
        if (gen !== searchGenRef.current) return
        setLyricsPhase({ kind: 'manual', source: 'paste' })
      })
  }

  useEffect(() => {
    if (!title.trim() || lyricsPhase.kind !== 'idle') return
    runSearch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, artist, videoId])

  const skipLyricSearch = (source: ManualLyricSource) => {
    searchGenRef.current++
    setMatchConfirmed(false)
    setLyricsPhase({ kind: 'manual', source })
    setError('')
  }

  async function resolveManualLines(): Promise<TimedLine[] | null> {
    if (lyricsPhase.kind === 'found') return lyricsPhase.lines
    if (lyricsPhase.kind === 'manual') {
      if (lyricsPhase.source === 'paste') return linesFromPlainText(pasted)
      if (!subtitleFile) {
        setError('Choose a subtitle file or paste lyrics instead.')
        return null
      }
      const text = await subtitleFile.text()
      return parseSubtitle(text, subtitleFile.name)
    }
    return null
  }

  const handleApply = async () => {
    setError('')
    setApplying(true)
    try {
      const lines = await resolveManualLines()
      if (lines === null) {
        setApplying(false)
        return
      }
      const finalLines = lines.length
        ? await normalizeImportedLines(title.trim(), artist.trim(), lines)
        : lines
      onApply(finalLines)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not import lyrics')
      setApplying(false)
    }
  }

  const manualTabClass = (s: ManualLyricSource) =>
    `px-3 py-1.5 rounded-lg text-xs touch-manipulation ${lyricsPhase.kind === 'manual' && lyricsPhase.source === s ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`

  const lyricsReady =
    (lyricsPhase.kind === 'found'
      && lyricsFoundReadyToApply(title, artist, lyricsPhase.match, matchConfirmed))
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'paste' && pasted.trim())
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'subtitle' && subtitleFile)

  const skipSearchButtons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={manualTabClass('paste')} onClick={() => skipLyricSearch('paste')}>
        Paste lyrics
      </button>
      <button type="button" className={manualTabClass('subtitle')} onClick={() => skipLyricSearch('subtitle')}>
        Subtitle file
      </button>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-xs bg-cinnabar-900 text-white/50 touch-manipulation"
        onClick={runSearch}
      >
        Search again
      </button>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/40 text-pretty">
        {videoId
          ? 'Checks YouTube captions first, then LRCLIB.'
          : 'Searches LRCLIB for synced or plain lyrics.'}
      </p>

      <div className="rounded-xl border border-cinnabar-800 bg-cinnabar-900/50 p-4 space-y-3">
        {lyricsPhase.kind === 'idle' && (
          <p className="text-white/35 text-xs">Starting lyrics search…</p>
        )}

        {lyricsPhase.kind === 'searching' && (
          <div className="space-y-2">
            <p className="text-white/35 text-xs text-center py-1">
              {videoId ? 'Checking YouTube captions & LRCLIB…' : 'Searching LRCLIB…'}
            </p>
            <p className="text-white/25 text-[10px] text-center">Or add lyrics manually:</p>
            {skipSearchButtons}
          </div>
        )}

        {lyricsPhase.kind === 'found' && (
          <LyricsFoundConfirm
            queriedTitle={title}
            queriedArtist={artist}
            lines={lyricsPhase.lines}
            synced={lyricsPhase.synced}
            sourceLabel={lyricsSourceLabel(lyricsPhase.source)}
            match={lyricsPhase.match}
            fromVideoCaptions={lyricsPhase.source === 'youtube-captions'}
            confirmed={matchConfirmed}
            onConfirm={() => setMatchConfirmed(true)}
            onUseDifferent={() => skipLyricSearch('paste')}
          />
        )}

        {lyricsPhase.kind === 'manual' && (
          <>
            <p className="text-white/35 text-xs text-pretty">No automatic match — paste lyrics or choose a subtitle file.</p>
            {skipSearchButtons}
            {lyricsPhase.source === 'paste' && (
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Paste lyrics, one line per row…"
                rows={6}
                className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
              />
            )}
            {lyricsPhase.source === 'subtitle' && (
              <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
                {subtitleFile ? subtitleFile.name : 'Choose a .lrc / .srt / .vtt file…'}
                <input
                  type="file"
                  accept=".lrc,.srt,.vtt,text/plain"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSubtitleFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </>
        )}
      </div>

      {error && <p className="text-red-400/90 text-sm" role="alert">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-cinnabar-800 text-white/60 text-sm touch-manipulation"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!lyricsReady || applying}
          className="flex-1 py-2.5 rounded-xl bg-cinnabar-accent text-white text-sm font-medium disabled:opacity-40 touch-manipulation"
        >
          {applying ? 'Applying…' : applyLabel}
        </button>
      </div>
    </div>
  )
}
