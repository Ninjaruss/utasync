import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { findLyrics } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
import { detectLanguage } from '../lyrics/bilingual'
import { ingestAudioFile } from './audioIngest'
import { normalizeImportedLines } from './importNormalize'
import type { TimedLine, Language } from '../core/types'
import { parseSubtitle } from '../lyrics/subtitle-parser'
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

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [loading, setLoading] = useState<{ message: string; detail?: string } | null>(null)
  const [error, setError] = useState('')
  const searchGenRef = useRef(0)

  const loadMetadata = async () => {
    if (!url.trim()) return
    setError('')
    setLoading({ message: 'Fetching song info…', detail: 'Reading YouTube metadata' })
    try {
      const meta = await fetchYouTubeMeta(url)
      setTitle(meta.title)
      setArtist(meta.artist)
      setMetaLoaded(true)
      searchGenRef.current++
      setLyricsPhase({ kind: 'idle' })
      setLoading(null)
    } catch (e: unknown) {
      setLoading(null)
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const resetLyricsOnMetadataEdit = () => {
    if (lyricsPhase.kind === 'found' || lyricsPhase.kind === 'searching') {
      searchGenRef.current++
      setLyricsPhase({ kind: 'idle' })
    }
  }

  const skipLyricSearch = (source: ManualLyricSource) => {
    searchGenRef.current++
    setLyricsPhase({ kind: 'manual', source })
    setError('')
  }

  useEffect(() => {
    if (!metaLoaded || !title.trim() || lyricsPhase.kind !== 'idle') return

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
  }, [metaLoaded, title, artist, lyricsPhase.kind])

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

  const handleCreate = async () => {
    if (!metaLoaded || !title.trim()) return
    setError('')
    setLoading({ message: 'Saving song…', detail: 'Writing to your library' })
    try {
      const lines = await resolveLines()
      if (lines === null) {
        setLoading(null)
        return
      }

      setLoading({ message: 'Normalizing lyrics…', detail: 'Finding translation and pairing lines' })
      const finalLines = lines.length
        ? await normalizeImportedLines(title.trim(), artist.trim(), lines)
        : lines

      const primaryLang = finalLines.length ? detectLanguage(finalLines.map((l) => l.original).join('\n')) : 'other'
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : 'en'
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      let audioStoredPath: string | undefined
      let songId: string | undefined
      if (audioFile) {
        setLoading({ message: 'Saving audio…', detail: 'Copying file to local storage' })
        const ingested = await ingestAudioFile(audioFile)
        audioStoredPath = ingested.audioStoredPath
        songId = ingested.songId
      }

      const input: BuildSongInput = {
        id: songId, title: title.trim(), artist: artist.trim(), sourceUrl: url, audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage,
      }
      const song = buildSong(input)
      await db.songs.put(song)
      setLoading(null)
      onSongReady(song.id)
    } catch (e: unknown) {
      setLoading(null)
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
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
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6">
      {loading && <LoadingOverlay message={loading.message} detail={loading.detail} />}
      <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
      <p className="text-white/50 text-sm text-center">Learn languages through music</p>

      <div className="w-full max-w-md space-y-3">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setMetaLoaded(false) }}
          placeholder="Paste a YouTube link…"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
        />

        <label
          aria-label="Attach audio for instant auto-sync (optional)"
          className="block w-full px-4 py-3 bg-cinnabar-900 text-white/60 rounded-xl border border-cinnabar-800 cursor-pointer text-xs"
        >
          {audioFile ? audioFile.name : '+ Attach audio for instant auto-sync (optional)'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {!metaLoaded ? (
          <button
            onClick={loadMetadata}
            disabled={!url.trim() || !!loading}
            className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <>
            <p className="text-white/40 text-xs text-pretty">
              Verify title and artist — LRCLIB search starts automatically.
            </p>

            <div className="space-y-2">
              <label htmlFor="link-song-title" className="text-xs font-medium text-white/50 uppercase tracking-wide">
                Song title
              </label>
              <input
                id="link-song-title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); resetLyricsOnMetadataEdit() }}
                className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="link-song-artist" className="text-xs font-medium text-white/50 uppercase tracking-wide">
                Artist
              </label>
              <input
                id="link-song-artist"
                value={artist}
                onChange={(e) => { setArtist(e.target.value); resetLyricsOnMetadataEdit() }}
                className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
              />
            </div>

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
                <p className="text-green-400/90 text-sm">
                  Found {lyricsPhase.synced ? 'synced' : 'plain'} lyrics ({lyricsPhase.lines.length} lines)
                </p>
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

            <button
              onClick={handleCreate}
              disabled={!lyricsReady || !!loading}
              className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
            >
              Add song
            </button>
          </>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
