import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { resolveLyricsForSong, lyricsSourceLabel, type LyricsResolveFoundSource, type ResolveLyricsStage } from './lyricsResolver'
import { db } from '../core/db/schema'
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
import { detectLanguage } from '../lyrics/bilingual'
import { ingestAudioFile } from './audioIngest'
import { resolveCoverArt } from './coverArt'
import type { TimedLine, Language } from '../core/types'
import { parseSubtitle } from '../lyrics/subtitle-parser'
import { ProgressOverlay } from '../core/ui/ProgressOverlay'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { LyricsFoundConfirm, lyricsFoundReadyToApply } from '../lyrics/LyricsFoundConfirm'
import type { LyricsLookupMatch } from './lrclib'
import {
  RESOLVE_LYRICS_STATUS,
  resolveLyricsSubsteps,
} from '../core/ui/progressUtils'
import {
  LINK_METADATA_STEPS,
  LINK_LYRIC_SEARCH_STEPS,
  linkSaveSteps,
  linkSaveStepIndex,
  type LinkSavePhase,
} from './addSongProgress'
import { getDefaultSongLanguage } from '../payment/SettingsStore'

type ManualLyricSource = 'paste' | 'subtitle'

type LyricsPhase =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; lines: TimedLine[]; synced: boolean; sourceLabel: string; source: LyricsResolveFoundSource; match?: LyricsLookupMatch }
  | { kind: 'manual'; source: ManualLyricSource }

interface Props {
  onSongReady: (songId: string) => void
  /** When true, renders inside AddSongSheet without standalone page chrome. */
  embedded?: boolean
  onBusyChange?: (busy: boolean) => void
}

export function LinkParser({ onSongReady, embedded = false, onBusyChange }: Props) {
  const [url, setUrl] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [saveProgress, setSaveProgress] = useState<{ phase: LinkSavePhase; includeAudio: boolean; taskProgress?: number | null } | null>(null)
  const [lyricSearchStage, setLyricSearchStage] = useState<ResolveLyricsStage | null>(null)
  const [error, setError] = useState('')
  const [matchConfirmed, setMatchConfirmed] = useState(false)
  const searchGenRef = useRef(0)

  const isBusy = !!saveProgress || metadataLoading || lyricsPhase.kind === 'searching'
  useEffect(() => {
    onBusyChange?.(isBusy)
  }, [isBusy, onBusyChange])

  const loadMetadata = async () => {
    if (!url.trim()) return
    setError('')
    setMetadataLoading(true)
    try {
      const meta = await fetchYouTubeMeta(url)
      setTitle(meta.title)
      setArtist(meta.artist)
      setVideoId(meta.videoId)
      setThumbnailUrl(meta.thumbnailUrl)
      setMetaLoaded(true)
      searchGenRef.current++
      setLyricsPhase({ kind: 'idle' })
      setMetadataLoading(false)
    } catch (e: unknown) {
      setMetadataLoading(false)
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
    setMatchConfirmed(false)
    setLyricsPhase({ kind: 'manual', source })
    setError('')
  }

  useEffect(() => {
    if (!metaLoaded || !title.trim() || lyricsPhase.kind !== 'idle') return

    const gen = ++searchGenRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: start lyric search when inputs settle
    setLyricsPhase({ kind: 'searching' })
    setLyricSearchStage(videoId ? 'youtube' : 'lrclib-exact')
    setError('')

    resolveLyricsForSong({
      title: title.trim(),
      artist: artist.trim(),
      videoId,
      sourceLanguage: getDefaultSongLanguage(),
      onStage: (stage) => {
        if (gen !== searchGenRef.current) return
        setLyricSearchStage(stage)
      },
    })
      .then((result) => {
        if (gen !== searchGenRef.current) return
        setLyricSearchStage(null)
        if (result.lines.length > 0 && result.source !== 'none') {
          setMatchConfirmed(false)
          setLyricsPhase({
            kind: 'found',
            lines: result.lines,
            synced: result.synced,
            sourceLabel: lyricsSourceLabel(result.source),
            source: result.source,
            match: result.match,
          })
        } else {
          setLyricsPhase({ kind: 'manual', source: 'paste' })
        }
      })
      .catch(() => {
        if (gen !== searchGenRef.current) return
        setLyricSearchStage(null)
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
    const includeAudio = !!audioFile
    setSaveProgress({ phase: 'preparing', includeAudio })
    try {
      const lines = await resolveLines()
      if (lines === null) {
        setSaveProgress(null)
        return
      }

      const finalLines = lines

      const primaryLang = finalLines.length ? detectLanguage(finalLines.map((l) => l.original).join('\n')) : 'other'
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : getDefaultSongLanguage()
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      let audioStoredPath: string | undefined
      let songId: string | undefined
      if (audioFile) {
        setSaveProgress({ phase: 'saving-audio', includeAudio })
        const ingested = await ingestAudioFile(audioFile)
        audioStoredPath = ingested.audioStoredPath
        songId = ingested.songId
      }

      setSaveProgress({ phase: 'saving-song', includeAudio })
      const albumArtUrl = await resolveCoverArt({
        title: title.trim(),
        artist: artist.trim(),
        audioFile,
        youtubeThumbnailUrl: thumbnailUrl,
      })

      const input: BuildSongInput = {
        id: songId, title: title.trim(), artist: artist.trim(), sourceUrl: url, audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage, albumArtUrl,
      }
      const song = buildSong(input)
      await db.songs.put(song)
      setSaveProgress(null)
      onSongReady(song.id)
    } catch (e: unknown) {
      setSaveProgress(null)
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const manualTabClass = (s: ManualLyricSource) =>
    `px-3 py-1.5 rounded-lg text-xs ${lyricsPhase.kind === 'manual' && lyricsPhase.source === s ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`

  const lyricsReady =
    (lyricsPhase.kind === 'found'
      && lyricsFoundReadyToApply(title, artist, lyricsPhase.match, matchConfirmed))
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'paste' && pasted.trim())
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'subtitle' && subtitleFile)

  const lyricSearchStatus =
    lyricsPhase.kind === 'idle'
      ? 'Starting lyric search…'
      : lyricSearchStage
        ? RESOLVE_LYRICS_STATUS[lyricSearchStage]
        : RESOLVE_LYRICS_STATUS['lrclib-exact']

  const lyricSearchPanelClass = 'rounded-lg border border-cinnabar-800/80 bg-cinnabar-950/60 p-2.5'

  const lyricSearchProgress = (
    <ProcessProgress
      compact
      steps={LINK_LYRIC_SEARCH_STEPS}
      currentStepIndex={0}
      taskStatus={lyricSearchStatus}
      taskSubsteps={
        lyricsPhase.kind === 'searching'
          ? resolveLyricsSubsteps(lyricSearchStage, !!videoId)
          : undefined
      }
      className={lyricSearchPanelClass}
    />
  )

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

  const fieldClass = 'w-full px-4 py-3 md:py-2 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30'
  const fileLabelClass = 'block w-full px-4 py-3 md:py-2 bg-cinnabar-900 text-white/60 rounded-xl border border-cinnabar-800 cursor-pointer text-xs text-pretty'

  return (
    <div className={embedded ? 'w-full flex flex-col flex-1 min-h-0' : 'min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6'}>
      {metadataLoading && (
        <ProgressOverlay
          steps={LINK_METADATA_STEPS}
          currentStepIndex={0}
          taskStatus="Reading YouTube metadata…"
        />
      )}
      {saveProgress && (
        <ProgressOverlay
          steps={linkSaveSteps(saveProgress.includeAudio)}
          currentStepIndex={linkSaveStepIndex(saveProgress.phase, saveProgress.includeAudio)}
          taskProgress={saveProgress.taskProgress}
        />
      )}
      {!embedded && (
        <>
          <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
          <p className="text-white/50 text-sm text-center">Learn languages through music</p>
        </>
      )}

      <div className={embedded ? 'flex flex-col flex-1 min-h-0 gap-2 md:gap-2.5' : 'w-full max-w-md space-y-3'}>
        <div className={embedded ? 'shrink-0 space-y-2 md:space-y-2' : 'space-y-3'}>
        <label htmlFor="link-youtube-url" className="sr-only">YouTube link</label>
        <input
          id="link-youtube-url"
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setMetaLoaded(false); setThumbnailUrl(null) }}
          placeholder="Paste a YouTube link…"
          autoComplete="off"
          className={fieldClass}
        />

        <label
          aria-label="Attach audio file to unlock AI align and export"
          className={fileLabelClass}
        >
          {audioFile ? audioFile.name : '+ Add audio file (unlocks AI align & export — optional)'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {!metaLoaded ? (
          <button
            type="button"
            onClick={loadMetadata}
            disabled={!url.trim() || metadataLoading || !!saveProgress}
            className="w-full py-3 md:py-2.5 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <>
            <p className="text-white/40 text-xs text-pretty">
              Verify title and artist — YouTube captions and LRCLIB are checked automatically.
            </p>

            <div className="space-y-1.5 md:space-y-2">
              <label htmlFor="link-song-title" className="text-xs font-medium text-white/50 uppercase tracking-wide">
                Song title
              </label>
              <input
                id="link-song-title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); resetLyricsOnMetadataEdit() }}
                className={fieldClass}
              />
            </div>

            <div className="space-y-1.5 md:space-y-2">
              <label htmlFor="link-song-artist" className="text-xs font-medium text-white/50 uppercase tracking-wide">
                Artist
              </label>
              <input
                id="link-song-artist"
                value={artist}
                onChange={(e) => { setArtist(e.target.value); resetLyricsOnMetadataEdit() }}
                className={fieldClass}
              />
            </div>
          </>
        )}
        </div>

        {metaLoaded && (
          <div className={embedded ? 'flex-1 min-h-0 flex flex-col rounded-xl border border-cinnabar-800 bg-cinnabar-900/50 overflow-hidden' : 'rounded-xl border border-cinnabar-800 bg-cinnabar-900/50 p-4 space-y-3'}>
            <div className={embedded ? 'flex-1 min-h-0 overflow-y-auto p-3 space-y-2 md:space-y-3' : 'space-y-3'}>
            <h2 className="text-sm font-medium text-white/70 shrink-0">Lyrics</h2>

              {lyricsPhase.kind === 'idle' && (
                <div className="space-y-2">
                  {lyricSearchProgress}
                  {skipSearchButtons}
                </div>
              )}

              {lyricsPhase.kind === 'searching' && (
                <div className="space-y-2">
                  {lyricSearchProgress}
                  <p className="text-white/25 text-[10px] text-center text-pretty">Skip search and add lyrics manually:</p>
                  {skipSearchButtons}
                </div>
              )}

              {lyricsPhase.kind === 'found' && (
                <LyricsFoundConfirm
                  queriedTitle={title}
                  queriedArtist={artist}
                  lines={lyricsPhase.lines}
                  synced={lyricsPhase.synced}
                  sourceLabel={lyricsPhase.sourceLabel}
                  match={lyricsPhase.match}
                  fromVideoCaptions={lyricsPhase.source === 'youtube-captions'}
                  confirmed={matchConfirmed}
                  onConfirm={() => setMatchConfirmed(true)}
                  onUseDifferent={() => skipLyricSearch('paste')}
                />
              )}

              {lyricsPhase.kind === 'manual' && (
                <>
                  <p className="text-white/35 text-xs text-pretty">No captions or LRCLIB match — paste lyrics or choose a subtitle file.</p>
                  {skipSearchButtons}
                  {lyricsPhase.source === 'paste' && (
                    <textarea
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder="Paste lyrics, one line per row…"
                      rows={embedded ? 4 : 6}
                      className={[fieldClass, embedded ? 'min-h-[5rem] resize-y' : ''].join(' ')}
                    />
                  )}
                  {lyricsPhase.source === 'subtitle' && (
                    <label className={fileLabelClass}>
                      {subtitleFile ? subtitleFile.name : 'Choose a .lrc / .srt / .vtt file…'}
                      <input type="file" accept=".lrc,.srt,.vtt,text/plain" className="hidden"
                        onChange={(e) => setSubtitleFile(e.target.files?.[0] ?? null)} />
                    </label>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {metaLoaded && (
          <div className={embedded ? 'shrink-0 pt-2' : undefined}>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!lyricsReady || !!saveProgress || metadataLoading}
              className="w-full py-3 md:py-2.5 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
            >
              Add song
            </button>
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center shrink-0">{error}</p>}
      </div>
    </div>
  )
}
