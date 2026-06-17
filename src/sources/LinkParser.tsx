import { useState, type ChangeEvent } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { findLyrics, findSecondLanguageLyrics } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
import { detectLanguage, attachSecondLanguage } from '../lyrics/bilingual'
import { ingestAudioFile } from './audioIngest'
import type { TimedLine, Language } from '../core/types'

interface Props {
  onSongReady: (songId: string) => void
}

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleParse = async () => {
    setError('')
    setStatus('Fetching song info…')
    try {
      const meta = await fetchYouTubeMeta(url)
      setStatus('Searching for lyrics…')

      let lines: TimedLine[] = []
      try {
        const found = await findLyrics(meta.title, meta.artist)
        if (found) lines = found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)
      } catch {
        // Lyrics not found — continue with empty lines
      }

      const primaryText = lines.map((l) => l.original).join('\n')
      const primaryLang = lines.length ? detectLanguage(primaryText) : 'other'
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : 'en'
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      // Best-effort, non-blocking second language: attach only on a clean
      // match; any mismatch or miss is skipped silently — the user adds one
      // later via SecondLanguagePanel in Edit mode.
      let finalLines = lines
      if (lines.length) {
        setStatus('Looking for a translation…')
        try {
          const second = await findSecondLanguageLyrics(meta.title, meta.artist, primaryLang)
          if (second) {
            const result = attachSecondLanguage(lines, second.lrc)
            if (result.mismatchedBlocks.length === 0) finalLines = result.lines
          }
        } catch {
          // Translation lookup failed — continue with primary only
        }
      }

      let audioStoredPath: string | undefined
      let songId: string | undefined
      if (audioFile) {
        setStatus('Storing audio…')
        const ingested = await ingestAudioFile(audioFile)
        audioStoredPath = ingested.audioStoredPath
        songId = ingested.songId
      }

      setStatus('Saving…')
      const input: BuildSongInput = {
        id: songId, title: meta.title, artist: meta.artist, sourceUrl: url, audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage,
      }
      const song = buildSong(input)
      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
      <p className="text-white/50 text-sm text-center">Learn languages through music</p>

      <div className="w-full max-w-md space-y-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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

        <button
          onClick={handleParse}
          disabled={!url || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          {status || 'Get Lyrics'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
