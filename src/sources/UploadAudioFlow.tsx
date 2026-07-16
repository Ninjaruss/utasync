// src/sources/UploadAudioFlow.tsx
import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { db } from '../core/db/schema'
import { ingestAudioFile } from './audioIngest'
import { buildSong, linesFromPlainText } from './songBuilder'
import { findLyrics, type FindLyricsStage, type LyricsLookupMatch } from './lrclib'
import { detectLanguage } from '../lyrics/bilingual'
import type { Language } from '../core/types'
import { parseLRC } from '../lyrics/lrc-parser'
import { parseSubtitle } from '../lyrics/subtitle-parser'
import { LyricsFoundConfirm, lyricsFoundReadyToApply } from '../lyrics/LyricsFoundConfirm'
import {
  extractAudioMetadata,
  resolveTrackMetadata,
  type MetadataFieldSource,
} from './audioMetadata'
import type { TimedLine } from '../core/types'
import { ProgressOverlay } from '../core/ui/ProgressOverlay'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import {
  FIND_LYRICS_STATUS,
  findLyricsSubsteps,
} from '../core/ui/progressUtils'
import {
  UPLOAD_SAVE_STEPS,
  UPLOAD_LYRIC_SEARCH_STEPS,
  uploadSaveStepIndex,
  type UploadSavePhase,
} from './addSongProgress'
import { resolveCoverArt } from './coverArt'
import { getDefaultSongLanguage } from '../payment/SettingsStore'
import { inferPreferredLyricsLanguage } from './lyricsMatch'

type ManualLyricSource = 'paste' | 'subtitle'

type LyricsPhase =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; lines: TimedLine[]; synced: boolean; match?: LyricsLookupMatch }
  | { kind: 'manual'; source: ManualLyricSource }

interface Props {
  onSongReady: (songId: string) => void
  /** When true, renders inside AddSongSheet without standalone page chrome. */
  embedded?: boolean
  /** Called when lyric search or save is in progress — parent can guard dismiss. */
  onBusyChange?: (busy: boolean) => void
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

export function UploadAudioFlow({ onSongReady, embedded = false, onBusyChange }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined)
  const [titleSource, setTitleSource] = useState<MetadataFieldSource | null>(null)
  const [artistSource, setArtistSource] = useState<MetadataFieldSource | null>(null)
  const [filenameAmbiguous, setFilenameAmbiguous] = useState(false)
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPhase>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [saveProgress, setSaveProgress] = useState<{ phase: UploadSavePhase; taskProgress?: number | null } | null>(null)
  const [lyricSearchStage, setLyricSearchStage] = useState<FindLyricsStage | null>(null)
  const [error, setError] = useState('')
  const [matchConfirmed, setMatchConfirmed] = useState(false)
  const searchGenRef = useRef(0)

  const isBusy = !!saveProgress || lyricsPhase.kind === 'searching'
  useEffect(() => {
    onBusyChange?.(isBusy)
  }, [isBusy, onBusyChange])

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (!f) return
    // Block the lyrics-search effect from firing off a stale `file`+`title`
    // pair before file metadata (incl. duration) has finished decoding.
    searchGenRef.current++
    setLyricsPhase({ kind: 'searching' })
    const tags = await extractAudioMetadata(f)
    const resolved = resolveTrackMetadata(tags, f.name)
    const hadTitle = title.trim().length > 0
    setTitle((cur) => cur || resolved.title)
    setArtist((cur) => cur || resolved.artist)
    setDurationSec(tags.durationSec)
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
    setMatchConfirmed(false)
    setLyricsPhase({ kind: 'manual', source })
    setError('')
  }

  const useDifferentLyrics = () => skipLyricSearch('paste')

  useEffect(() => {
    if (!file || !title.trim() || lyricsPhase.kind !== 'idle') return

    const gen = ++searchGenRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: start lyric search when inputs settle
    setLyricsPhase({ kind: 'searching' })
    setLyricSearchStage('exact')
    setError('')

    findLyrics(title.trim(), artist.trim(), (stage) => {
      if (gen !== searchGenRef.current) return
      setLyricSearchStage(stage)
    }, durationSec, inferPreferredLyricsLanguage(title.trim(), artist.trim(), getDefaultSongLanguage()))
      .then((found) => {
        if (gen !== searchGenRef.current) return
        setLyricSearchStage(null)
        if (found) {
          const lines = found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)
          setMatchConfirmed(false)
          setLyricsPhase({ kind: 'found', lines, synced: found.synced, match: found.match })
        } else {
          setLyricsPhase({ kind: 'manual', source: 'paste' })
        }
      })
      .catch(() => {
        if (gen !== searchGenRef.current) return
        setLyricSearchStage(null)
        setLyricsPhase({ kind: 'manual', source: 'paste' })
      })
  }, [file, title, artist, lyricsPhase.kind, durationSec])

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
    setSaveProgress({ phase: 'preparing' })
    try {
      const lines = await resolveLines()
      if (lines === null) {
        setSaveProgress(null)
        return
      }
      if (lines.length === 0) {
        setSaveProgress(null)
        setError('No lyric lines found. Add lyrics before creating the song.')
        return
      }

      const finalLines = lines

      const primaryLang = detectLanguage(finalLines.map((l) => l.original).join('\n'))
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : getDefaultSongLanguage()
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      setSaveProgress({ phase: 'saving-audio' })
      const { songId, audioStoredPath } = await ingestAudioFile(file)
      const albumArtUrl = await resolveCoverArt({
        title: title.trim(),
        artist: artist.trim(),
        audioFile: file,
      })
      const song = buildSong({
        id: songId, title: title.trim(), artist: artist.trim(), audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage, albumArtUrl,
      })
      setSaveProgress({ phase: 'saving-song' })
      await db.songs.put(song)
      setSaveProgress(null)
      onSongReady(song.id)
    } catch (e: unknown) {
      setSaveProgress(null)
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
    (lyricsPhase.kind === 'found'
      && lyricsFoundReadyToApply(title, artist, lyricsPhase.match, matchConfirmed))
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'paste' && pasted.trim())
    || (lyricsPhase.kind === 'manual' && lyricsPhase.source === 'subtitle' && subtitleFile)

  const lyricSearchStatus =
    lyricsPhase.kind === 'idle'
      ? 'Starting lyric search…'
      : lyricSearchStage
        ? FIND_LYRICS_STATUS[lyricSearchStage]
        : FIND_LYRICS_STATUS.exact

  const lyricSearchProgress = (extraClassName: string) => (
    <ProcessProgress
      compact
      steps={UPLOAD_LYRIC_SEARCH_STEPS}
      currentStepIndex={0}
      taskStatus={lyricSearchStatus}
      taskSubsteps={lyricsPhase.kind === 'searching' ? findLyricsSubsteps(lyricSearchStage) : undefined}
      className={extraClassName}
    />
  )

  const lyricSearchPanelClass = 'rounded-lg border border-cinnabar-800/80 bg-cinnabar-950/60 p-2.5'

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
  const fileLabelClass = 'block w-full px-4 py-3 md:py-2 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm'

  return (
    <div className={embedded ? 'w-full flex flex-col flex-1 min-h-0' : 'min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-5'}>
      {saveProgress && (
        <ProgressOverlay
          steps={UPLOAD_SAVE_STEPS}
          currentStepIndex={uploadSaveStepIndex(saveProgress.phase)}
          taskProgress={saveProgress.taskProgress}
        />
      )}

      {!embedded && (
        <h1 className="text-2xl font-bold text-cinnabar-accent tracking-widest">Upload audio</h1>
      )}

      <div className={embedded ? 'flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 md:gap-2.5' : 'w-full max-w-md space-y-3'}>
        <div className={embedded ? 'shrink-0 space-y-2 md:space-y-2' : 'space-y-3'}>
        <label className={fileLabelClass}>
          {file ? file.name : 'Choose an audio file…'}
          <input type="file" accept="audio/*" className="hidden"
            onChange={handleFileChange} />
        </label>

        <p className="text-white/40 text-xs text-pretty">
          Check the song title and artist — LRCLIB search starts once a file and title are set. Adding artist improves matches.
        </p>

        <div className="space-y-1.5 md:space-y-2">
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
            className={fieldClass}
          />
        </div>

        <div className="space-y-1.5 md:space-y-2">
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
            className={fieldClass}
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
        </div>

        {file && title.trim() && (
          <div className={embedded ? 'flex-1 shrink-0 flex flex-col rounded-xl border border-cinnabar-800 bg-cinnabar-900/50' : 'rounded-xl border border-cinnabar-800 bg-cinnabar-900/50 p-4 space-y-3'}>
            <div className={embedded ? 'flex-1 flex flex-col p-3 md:p-3 space-y-2 md:space-y-3' : 'space-y-3'}>
            <h2 className="text-sm font-medium text-white/70 shrink-0">Lyrics</h2>

            {lyricsPhase.kind === 'idle' && (
              <div className="space-y-2">
                {lyricSearchProgress(lyricSearchPanelClass)}
                {skipSearchButtons}
              </div>
            )}

            {lyricsPhase.kind === 'searching' && (
              <div className="space-y-2">
                {lyricSearchProgress(lyricSearchPanelClass)}
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
                sourceLabel="LRCLIB"
                match={lyricsPhase.match}
                confirmed={matchConfirmed}
                onConfirm={() => setMatchConfirmed(true)}
                onUseDifferent={useDifferentLyrics}
              />
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
                    rows={embedded ? 8 : 6}
                    className={[fieldClass, embedded ? 'flex-1 min-h-[7rem] resize-none' : ''].join(' ')}
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

        <div className={embedded ? 'shrink-0 pt-2 space-y-2' : 'space-y-3'}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!file || !title.trim() || !lyricsReady || !!saveProgress}
          className="w-full py-3 md:py-2.5 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          Add song
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>
      </div>
    </div>
  )
}
