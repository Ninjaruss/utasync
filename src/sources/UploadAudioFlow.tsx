// src/sources/UploadAudioFlow.tsx
import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { db } from '../core/db/schema'
import { ingestAudioFile } from './audioIngest'
import { buildSong, linesFromPlainText } from './songBuilder'
import { findLyrics } from './lrclib'
import { detectLanguage } from '../lyrics/bilingual'
import type { Language } from '../core/types'
import { parseLRC } from '../lyrics/lrc-parser'
import { parseSubtitle } from '../lyrics/subtitle-parser'
import { normalizeImportedLines } from './importNormalize'
import {
  extractAudioMetadata,
  resolveTrackMetadata,
  type MetadataFieldSource,
} from './audioMetadata'
import type { TimedLine } from '../core/types'
import { LoadingOverlay } from '../core/ui/LoadingOverlay'

type ManualLyricSource = 'paste' | 'subtitle'

type LyricsPhase =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; lines: TimedLine[]; synced: boolean }
  | { kind: 'manual'; source: ManualLyricSource }

interface Props {
  onSongReady: (songId: string) => void
}

const SOURCE_LABEL: Record<MetadataFieldSource, string> = {
  tag: 'From file tags',
  filename: 'From filename',
}

function FieldSourceBadge({ source }: { source: MetadataFieldSource | null }) {
  if (!source) return null
  return (
    <span className="text-[10px] uppercase tracking-wide text-cinnabar-accent/70 font-medium">
      {SOURCE_LABEL[source]}
    </span>
  )
}

export function UploadAudioFlow({ onSongReady }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [titleSource, setTitleSource] = useState<MetadataFieldSource | null>(null)
  const [artistSource, setArtistSource] = useState<MetadataFieldSource | null>(null)
  const [filenameAmbiguous, setFilenameAmbiguous] = useState(false)
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [loading, setLoading] = useState<{ message: string; detail?: string } | null>(null)
  const [error, setError] = useState('')
  const searchGenRef = useRef(0)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (!f) return
    const tags = await extractAudioMetadata(f)
    const resolved = resolveTrackMetadata(tags, f.name)
    const hadTitle = title.trim().length > 0
    setTitle((cur) => cur || resolved.title)
    setArtist((cur) => cur || resolved.artist)
    if (!hadTitle) {
      setTitleSource(resolved.titleSource)
      setArtistSource(resolved.artistSource)
      setFilenameAmbiguous(resolved.filenameAmbiguous)
    }
    searchGenRef.current++
    setLyricsPhase({ kind: 'idle' })
  }

  const resetLyricsOnMetadataEdit = () => {
    if (lyricsPhase.kind === 'found' || lyricsPhase.kind === 'searching') {
      searchGenRef.current++
      setLyricsPhase({ kind: 'idle' })
    }
  }

  const skipLyricSearch = (source: ManualLyricSource = 'paste') => {
    searchGenRef.current++
    setLyricsPhase({ kind: 'manual', source })
    setError('')
  }

  const useDifferentLyrics = () => skipLyricSearch('paste')

  useEffect(() => {
    if (!file || !title.trim() || lyricsPhase.kind !== 'idle') return

    const gen = ++searchGenRef.current
    setLyricsPhase({ kind: 'searching' })
    setError('')

    findLyrics(title.trim(), artist.trim())
      .then((found) => {
        if (gen !== searchGenRef.current) return
        if (found) {
          const lines = found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)
          setLyricsPhase({ kind: 'found', lines, synced: found.synced })
        } else {
          setLyricsPhase({ kind: 'manual', source: 'paste' })
        }
      })
      .catch(() => {
        if (gen !== searchGenRef.current) return
        setLyricsPhase({ kind: 'manual', source: 'paste' })
      })
  }, [file, title, artist, lyricsPhase.kind])

  async function resolveLines(): Promise<TimedLine[] | null> {
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

  const handleSubmit = async () => {
    if (!file || !title.trim()) return
    setError('')
    setLoading({ message: 'Saving song…', detail: 'Writing audio and lyrics to your library' })
    try {
      const lines = await resolveLines()
      if (lines === null) {
        setLoading(null)
        return
      }
      if (lines.length === 0) {
        setLoading(null)
        setError('No lyric lines found. Add lyrics before creating the song.')
        return
      }

      setLoading({ message: 'Normalizing lyrics…', detail: 'Finding translation and pairing lines' })
      const finalLines = await normalizeImportedLines(title.trim(), artist.trim(), lines)

      const primaryLang = detectLanguage(finalLines.map((l) => l.original).join('\n'))
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : 'en'
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      setLoading({ message: 'Saving audio…', detail: 'Copying file to local storage' })
      const { songId, audioStoredPath } = await ingestAudioFile(file)
      const song = buildSong({
        id: songId, title: title.trim(), artist: artist.trim(), audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage,
      })
      await db.songs.put(song)
      setLoading(null)
      onSongReady(song.id)
    } catch (e: unknown) {
      setLoading(null)
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  const swapTitleArtist = () => {
    setTitle(artist)
    setArtist(title)
    setTitleSource(artistSource)
    setArtistSource(titleSource)
    setFilenameAmbiguous(false)
    searchGenRef.current++
    setLyricsPhase({ kind: 'idle' })
  }

  const manualTabClass = (s: ManualLyricSource) =>
    `px-3 py-1.5 rounded-lg text-xs ${lyricsPhase.kind === 'manual' && lyricsPhase.source === s ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`

  const lyricsReady =
    lyricsPhase.kind === 'found'
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
    </div>
  )

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-5">
      {loading && <LoadingOverlay message={loading.message} detail={loading.detail} />}

      <h1 className="text-2xl font-bold text-cinnabar-accent tracking-widest">Upload audio</h1>

      <div className="w-full max-w-md space-y-3">
        <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
          {file ? file.name : 'Choose an audio file…'}
          <input type="file" accept="audio/*" className="hidden"
            onChange={handleFileChange} />
        </label>

        <p className="text-white/40 text-xs text-pretty">
          Check the song title and artist — LRCLIB search starts automatically once both are set.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="upload-song-title" className="text-xs font-medium text-white/50 uppercase tracking-wide">
              Song title
            </label>
            <FieldSourceBadge source={titleSource} />
          </div>
          <input
            id="upload-song-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleSource(null)
              setFilenameAmbiguous(false)
              resetLyricsOnMetadataEdit()
            }}
            placeholder="Song title"
            className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="upload-song-artist" className="text-xs font-medium text-white/50 uppercase tracking-wide">
              Artist
            </label>
            <FieldSourceBadge source={artistSource} />
          </div>
          <input
            id="upload-song-artist"
            value={artist}
            onChange={(e) => {
              setArtist(e.target.value)
              setArtistSource(null)
              setFilenameAmbiguous(false)
              resetLyricsOnMetadataEdit()
            }}
            placeholder="Artist name"
            className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
          />
        </div>

        {filenameAmbiguous && (
          <p className="text-amber-400/80 text-xs">
            Filename could be “Artist – Title” or “Title – Artist”. Swap if the fields look reversed.
          </p>
        )}

        {title.trim() && artist.trim() && (
          <button
            type="button"
            onClick={swapTitleArtist}
            className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
          >
            Swap title and artist
          </button>
        )}

        {file && title.trim() && (
          <div className="rounded-xl border border-cinnabar-800 bg-cinnabar-900/50 p-4 space-y-3">
            <h2 className="text-sm font-medium text-white/70">Lyrics</h2>

            {lyricsPhase.kind === 'idle' && (
              <div className="space-y-2">
                <p className="text-white/35 text-xs">Starting LRCLIB search…</p>
                {skipSearchButtons}
              </div>
            )}

            {lyricsPhase.kind === 'searching' && (
              <div className="space-y-2">
                <p className="text-white/35 text-xs text-center py-1">Searching LRCLIB…</p>
                <p className="text-white/25 text-[10px] text-center">Skip search and add lyrics manually:</p>
                {skipSearchButtons}
              </div>
            )}

            {lyricsPhase.kind === 'found' && (
              <div className="space-y-2">
                <p className="text-green-400/90 text-sm">
                  Found {lyricsPhase.synced ? 'synced' : 'plain'} lyrics ({lyricsPhase.lines.length} lines)
                </p>
                <ul className="space-y-1 max-h-28 overflow-y-auto rounded-lg bg-cinnabar-950 border border-cinnabar-800 p-2">
                  {lyricsPhase.lines.slice(0, 3).map((l, i) => (
                    <li key={i} className="text-xs text-white/60 truncate">{l.original || '—'}</li>
                  ))}
                  {lyricsPhase.lines.length > 3 && (
                    <li className="text-[10px] text-white/30">+{lyricsPhase.lines.length - 3} more…</li>
                  )}
                </ul>
                <button
                  type="button"
                  onClick={useDifferentLyrics}
                  className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
                >
                  Use different lyrics
                </button>
              </div>
            )}

            {lyricsPhase.kind === 'manual' && (
              <>
                <p className="text-white/35 text-xs">No LRCLIB match — paste lyrics or choose a subtitle file.</p>
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
                    <input type="file" accept=".lrc,.srt,.vtt,text/plain" className="hidden"
                      onChange={(e) => setSubtitleFile(e.target.files?.[0] ?? null)} />
                  </label>
                )}
              </>
            )}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!file || !title.trim() || !lyricsReady || !!loading}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          Add song
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>
    </div>
  )
}
